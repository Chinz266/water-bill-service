import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UNASSIGNED_STATUSES,
  UnassignedReadingEntity,
  UnassignedStatus,
} from '../entity/unassigned-reading.entity';
import { BillsService } from './bills.service';
import { MeterPhotoService } from './meter-photo.service';
import { ScanBatchService } from './scan-batch.service';
import {
  AssignUnassignedDto,
  CreateUnassignedReadingDto,
} from '../dto/unassigned-reading.dto';

/**
 * รูปมิเตอร์ที่ยังไม่รู้ว่าเป็นของบ้านหลังไหน — คิวรอ Admin จับคู่
 *
 * ═══ ทำไมต้องมีที่พักแบบนี้ ═══
 *
 * หน้างานเจอสองเคสที่คนเดินจดแก้เองไม่ได้: OCR อ่านเลขไม่ออกเพราะหน้าปัดฝ้า/โคลนบัง
 * และเคสที่อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน (ambiguous)
 *
 * ของเดิมไม่มีที่ให้วาง คนจึงมีทางเลือกแค่ "เดาแล้วกดไปก่อน" (ซึ่งไปโผล่เป็นบิลผิดบ้าน)
 * หรือ "ทิ้งรูปแล้วเดินกลับไปใหม่" — ทั้งสองทางแย่กว่าการยอมรับว่ายังไม่รู้
 *
 * ═══ ตอนจับคู่ไม่ได้ลัดด่านอะไรเลย ═══
 *
 * `assign()` วิ่งผ่าน `BillsService.createFromScan()` ตัวเดิม ด่านกันข้อมูลผิดทั้งหมด
 * (บิลซ้ำ, เลขต่ำกว่าเดือนก่อน, หน่วยพุ่ง, จำนวนหลัก, พิกัดซ้ำ) จึงยังทำงานครบ
 * ต่างจากการเขียน meter_readings ตรง ๆ ซึ่งจะข้ามด่านทุกอย่างไปเงียบ ๆ
 */
@Injectable()
export class UnassignedReadingsService {
  constructor(
    @InjectRepository(UnassignedReadingEntity)
    private readonly unassignedRepository: Repository<UnassignedReadingEntity>,
    private readonly meterPhotoService: MeterPhotoService,
    private readonly billsService: BillsService,
    private readonly scanBatchService: ScanBatchService,
  ) {}

  /**
   * รับรูปกำพร้าเข้าคิว
   *
   * บังคับต้องมีรูปเสมอ (ต่างจาก meter_readings ที่รูปเป็น optional) เพราะแถวนี้
   * ทั้งแถวมีไว้ให้คนมาตัดสินทีหลัง — ไม่มีรูปก็ไม่เหลืออะไรให้ตัดสินเลยแม้แต่ชิ้นเดียว
   * เก็บไว้ก็เป็นแค่ขยะที่ไม่มีวันถูกจับคู่
   */
  async create(dto: CreateUnassignedReadingDto) {
    if (!dto.meter_photo) {
      throw new BadRequestException(
        'ต้องแนบรูปหน้าปัดมิเตอร์มาด้วยครับ — รูปคือข้อมูลชิ้นเดียวที่ทำให้จับคู่กับบ้านได้ทีหลัง',
      );
    }

    const meter_unit = this.parseOptionalInt(dto.meter_unit, 'เลขมิเตอร์');
    const evidence_photo = await this.meterPhotoService.save(
      dto.meter_photo,
      0,
    );

    try {
      return await this.unassignedRepository.save(
        this.unassignedRepository.create({
          villages_id: dto.villages_id ?? null,
          meter_unit,
          meter_digits: this.parseOptionalInt(dto.meter_digits, 'จำนวนหลัก'),
          read_confidence: this.parseConfidence(dto.read_confidence),
          evidence_photo,
          latitude: this.parseCoordinate(dto.latitude, 'ละติจูด', 90),
          longitude: this.parseCoordinate(dto.longitude, 'ลองจิจูด', 180),
          gps_accuracy_m: this.parseOptionalInt(
            dto.gps_accuracy_m,
            'ความคลาดเคลื่อนของพิกัด',
          ),
          captured_at: this.parseCapturedAt(dto.captured_at),
          note: dto.note?.trim() || null,
          create_by: dto.create_by ?? null,
          status: 'Pending',
        }),
      );
    } catch (error) {
      // แถวไม่ได้ถูกสร้าง รูปที่เพิ่งเขียนจึงไม่มีเจ้าของ เก็บกวาดก่อนโยนต่อ
      // (แนวเดียวกับ createFromScan / registerOnsite)
      await this.meterPhotoService.remove(evidence_photo);
      throw error;
    }
  }

  /** คิวที่รออยู่ เก่าสุดขึ้นก่อน — ของที่ค้างนานคือของที่ต้องรีบตัดสินใจก่อนข้ามเดือน */
  async findAll(params: { status?: string; villages_id?: number }) {
    const status = UNASSIGNED_STATUSES.find((value) => value === params.status);

    return await this.unassignedRepository.find({
      where: {
        ...(status ? { status } : { status: 'Pending' as UnassignedStatus }),
        ...(params.villages_id ? { villages_id: params.villages_id } : {}),
      },
      order: { create_date: 'ASC' },
    });
  }

  /**
   * รูปหนึ่งใบพร้อมรายชื่อบ้านที่เป็นไปได้ — หน้าจับคู่เรียกตัวนี้
   *
   * ผู้สมัครคิดจากเกณฑ์ชุดเดียวกับหน้าอัปรูปทั้งชุด (ScanBatchService) ไม่ใช่สูตรใหม่
   * ไม่งั้นหน้านี้จะเสนอบ้านที่พอกดยืนยันจริงแล้วโดนตีกลับเป็น 409
   *
   * ไม่มีเลขมิเตอร์ (OCR อ่านไม่ออก) = คืน candidates ว่าง ให้คนเปิดรูปดูแล้วพิมพ์เลขเอง
   * ซึ่งเป็นสภาพที่ตรงไปตรงมากว่าการเดารายชื่อบ้านจากพิกัดที่คลาดได้ 30 เมตร
   */
  async findOneWithCandidates(
    id: number,
    billing_month: string,
    billing_year: string,
  ) {
    const row = await this.unassignedRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`ไม่พบข้อมูลกำพร้ารหัส ${id}`);
    }

    const candidates =
      row.meter_unit === null
        ? []
        : await this.scanBatchService.candidatesForUnit(
            Number(row.meter_unit),
            {
              billing_month,
              billing_year,
              villages_id: row.villages_id,
              latitude: row.latitude,
              longitude: row.longitude,
            },
          );

    return { ...row, candidates: candidates.slice(0, 5) };
  }

  /**
   * จับคู่กับบ้าน แล้วออกบิลผ่านเส้นทางปกติ
   *
   * ═══ ทำไมย้ายไฟล์รูปไม่ได้ ต้องส่ง data URL ใหม่ ═══
   *
   * `createFromScan()` รับรูปเป็น data URL แล้วเขียนไฟล์เอง (ผ่าน sharp เพื่อกันไฟล์
   * ที่ไม่ใช่รูปจริง) การส่ง path เดิมเข้าไปตรง ๆ จะข้ามชั้นนั้น — จึงอ่านไฟล์เดิม
   * กลับมาเป็น base64 แล้วส่งเข้าเส้นทางเดิมทั้งชุด ยอมจ่ายค่าอ่านไฟล์หนึ่งรอบ
   * แลกกับการไม่มีทางลัดที่ข้ามด่านความปลอดภัย
   *
   * รูปเดิมถูกลบหลังจับคู่สำเร็จ เพราะ createFromScan เขียนสำเนาใหม่ไปแล้ว
   */
  async assign(id: number, dto: AssignUnassignedDto) {
    const row = await this.unassignedRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`ไม่พบข้อมูลกำพร้ารหัส ${id}`);
    }
    if (row.status !== 'Pending') {
      throw new BadRequestException(
        `ข้อมูลกำพร้ารหัส ${id} ถูกจัดการไปแล้ว (สถานะ ${row.status}) ครับ`,
      );
    }

    // เลขที่คนตรวจพิมพ์เองชนะค่าที่ OCR อ่านได้ — คนเปิดรูปดูอยู่ตรงหน้า
    const current_unit =
      dto.current_unit !== undefined && dto.current_unit !== null
        ? Number(dto.current_unit)
        : Number(row.meter_unit);

    if (!Number.isInteger(current_unit) || current_unit < 0) {
      throw new BadRequestException(
        'ต้องระบุเลขมิเตอร์ที่อ่านได้จากรูปครับ (OCR อ่านไม่ออกจึงไม่มีค่าตั้งต้นให้)',
      );
    }

    const photoDataUrl = await this.meterPhotoService.toDataUrl(
      row.evidence_photo,
    );

    const bill = await this.billsService.createFromScan({
      members_id: dto.members_id,
      water_rates_id: dto.water_rates_id,
      current_unit,
      billing_month: dto.billing_month,
      billing_year: dto.billing_year,
      reading_date: dto.reading_date,
      meter_photo: photoDataUrl ?? undefined,
      // คนพิมพ์เลขเองทับค่า OCR = ถือเป็นการกรอกมือ ต้องมีรูปแนบ ซึ่งมีอยู่แล้วโดยนิยาม
      entry_method:
        dto.current_unit !== undefined && dto.current_unit !== null
          ? 'manual_after_ocr_fail'
          : 'ocr',
      meter_digits: row.meter_digits ?? undefined,
      read_confidence: row.read_confidence ?? undefined,
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
      gps_accuracy_m: row.gps_accuracy_m ?? undefined,
      captured_at: row.captured_at?.toISOString(),
      create_by: dto.create_by,
      replace: dto.replace,
      confirm_high_usage: dto.confirm_high_usage,
      confirm_meter_reset: dto.confirm_meter_reset,
      confirm_digit_change: dto.confirm_digit_change,
      confirm_low_confidence: dto.confirm_low_confidence,
      confirm_duplicate_location: dto.confirm_duplicate_location,
      confirm_stale_photo: dto.confirm_stale_photo,
    });

    await this.unassignedRepository.update(id, {
      status: 'Assigned',
      resolved_reading_id: bill.meter_readings_id,
      resolved_by: dto.create_by ?? null,
      resolved_date: new Date(),
    });

    // ลบสำเนาเดิมหลังบิลออกสำเร็จ — createFromScan เขียนไฟล์ใหม่ของตัวเองไปแล้ว
    await this.meterPhotoService.remove(row.evidence_photo);

    return { message: 'จับคู่รูปกับบ้านและออกบิลเรียบร้อยครับ', bill };
  }

  /**
   * ตีทิ้ง — รูปที่ตัดสินใจแล้วว่าใช้ไม่ได้ (เบลอจนอ่านไม่ออก / ถ่ายผิดของ)
   *
   * ลบไฟล์รูปทิ้งด้วย เพราะแถวที่ Discarded แล้วไม่มีใครกลับมาเปิดดูอีก
   * ปล่อยไว้ก็เป็นไฟล์ที่กินดิสก์ไปเรื่อย ๆ โดยไม่มีวันถูกอ้างถึง
   */
  async discard(id: number, note?: string, resolvedBy?: number) {
    const row = await this.unassignedRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException(`ไม่พบข้อมูลกำพร้ารหัส ${id}`);
    }
    if (row.status === 'Assigned') {
      throw new BadRequestException(
        `ข้อมูลกำพร้ารหัส ${id} ถูกจับคู่ออกบิลไปแล้ว ตีทิ้งไม่ได้ครับ`,
      );
    }

    await this.unassignedRepository.update(id, {
      status: 'Discarded',
      note: note?.trim() || row.note,
      resolved_by: resolvedBy ?? null,
      resolved_date: new Date(),
    });

    await this.meterPhotoService.remove(row.evidence_photo);

    return { message: `ตีทิ้งข้อมูลกำพร้ารหัส ${id} เรียบร้อยครับ` };
  }

  private parseOptionalInt(
    value: number | undefined | null,
    label: string,
  ): number | null {
    if (value === undefined || value === null || (value as unknown) === '') {
      return null;
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
      throw new BadRequestException(`${label}ต้องเป็นจำนวนเต็มไม่ติดลบครับ`);
    }
    return num;
  }

  private parseConfidence(value: number | undefined): number | null {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    // ปัดให้พอดีกับคอลัมน์ decimal(4,3) เหมือน BillsService
    return Math.round(Math.min(num, 1) * 1000) / 1000;
  }

  /** เหตุผลเดียวกับ BillsService.parseLocation — ค่านอกช่วงจะไปพังที่ MySQL เป็น 1264 */
  private parseCoordinate(
    value: number | undefined,
    label: string,
    limit: number,
  ): number | null {
    if (value === undefined || value === null || (value as unknown) === '') {
      return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num) || Math.abs(num) > limit) {
      throw new BadRequestException(
        `${label} "${String(value)}" ไม่ถูกต้อง ต้องเป็นตัวเลขระหว่าง -${limit} ถึง ${limit} ครับ`,
      );
    }
    return num;
  }

  private parseCapturedAt(raw: string | undefined): Date | null {
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
