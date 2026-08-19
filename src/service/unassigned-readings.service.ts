import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Not, Repository } from 'typeorm';
import {
  UNASSIGNED_STATUSES,
  UnassignedReadingEntity,
  UnassignedStatus,
} from '../entity/unassigned-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { BillsService } from './bills.service';
import { MeterPhotoService } from './meter-photo.service';
import { ScanBatchService } from './scan-batch.service';
import {
  AssignUnassignedDto,
  CreateUnassignedReadingDto,
} from '../dto/unassigned-reading.dto';
import { PhotoMetadataService } from './photo-metadata.service';

/**
 * ใบก่อนหน้าของ "มิเตอร์ตัวเดียวกัน" ที่ระบบเชื่อมให้ — null เมื่อเชื่อมไม่ได้
 *
 * ตั้งใจให้เป็นข้อเสนอที่คนกดยืนยันเอง ไม่ใช่การจับคู่ให้เสร็จสรรพ (ดู chainOf)
 */
export interface ChainLink {
  /** id ของคิวใบก่อนหน้า */
  id: number;
  captured_at: Date | null;
  meter_unit: number;
  /** หน่วยที่ใช้ไประหว่างสองใบ = เลขใบนี้ − เลขใบก่อน */
  usage_unit: number;
  days_apart: number;
  distance_m: number;
  status: UnassignedStatus;
  /** บ้านที่ใบก่อนถูกจับคู่ไปแล้ว — null = ใบก่อนก็ยังไม่รู้ว่าบ้านไหนเหมือนกัน */
  members_id: number | null;
  house_no: string | null;
  /**
   * ใบก่อนอยู่ในกลุ่มมิเตอร์ที่ติดกันหรือเปล่า
   *
   * true = ห้ามเชื่อทั้งดุ้น มิเตอร์ในกลุ่มห่างกัน 30 ซม. ซึ่งต่ำกว่าความคลาดเคลื่อน
   * ของพิกัดหลายสิบเท่า "ถ่ายที่เดิม" จึงไม่ได้แปลว่า "มิเตอร์ตัวเดิม" สำหรับกลุ่มนี้
   */
  cluster_group_id: string | null;
}

/**
 * รูปมิเตอร์ที่ยังไม่รู้ว่าเป็นของบ้านหลังไหน — คิวรอ Admin จับคู่
 *
 * ═══ ทำไมต้องมีที่พักแบบนี้ ═══
 *
 * หน้างานเจอสามเคสที่คนเดินจดแก้เองไม่ได้: OCR อ่านเลขไม่ออกเพราะหน้าปัดฝ้า/โคลนบัง,
 * เคสที่อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน (ambiguous) และเคสที่ **รู้บ้านแล้วแต่ด่านตีกลับ**
 * (หน่วยพุ่ง / เลขต่ำกว่าเดือนก่อน / จดสลับตัวในกลุ่มมิเตอร์ที่ติดกัน)
 *
 * เคสที่สามคือ "รอการตรวจสอบ" — คนหน้างานกดยืนยันข้ามด่านเองได้ก็จริง แต่คนที่ยืนกลางแดด
 * กับมิเตอร์อีก 40 ตัวที่ยังไม่ได้จดไม่ใช่คนที่ควรตัดสินว่ายอดที่ผิดปกตินี้ถูกหรือผิด
 * ทางเลือกที่สาม (ฝากไว้ให้คนที่มีเวลาเปิดรูปเทียบ) จึงจำเป็น ไม่งั้นเหลือแค่
 * "กดผ่านไปก่อน" ซึ่งทำให้ด่านทั้งหมดกลายเป็นพิธีกรรม
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
  /**
   * ระยะที่ยังถือว่า "ยืนถ่ายที่เดิม" ระหว่างรูปสองใบ (เมตร)
   *
   * ต่างจาก GPS_NEAR_M ตรงที่นี่คือการวัดสองครั้งเทียบกันเอง ไม่ใช่วัดเทียบกับ
   * จุดอ้างอิงที่จดไว้ — ความคลาดเคลื่อนของทั้งสองครั้งคือ ~30 ม. เท่ากัน
   * บวกกันแบบ RSS ได้ √(30² + 30²) ≈ 42 ปัดเป็น 45
   *
   * กว้างกว่านี้จะลากมิเตอร์ของบ้านถัดไปเข้ามาเป็น "ตัวเดียวกัน" ได้
   */
  static readonly CHAIN_NEAR_M = 45;

  /**
   * ห่างกันเกินกี่วันแล้วเลิกเชื่อม
   *
   * เกินหนึ่งรอบบิลไปแล้วการเชื่อมไม่ได้ช่วยอะไร — เลขที่ต่างกันไม่ใช่ "หน่วยที่ใช้ไป"
   * ของรอบเดียวกันอีกต่อไป และคิวที่ค้างนานขนาดนั้นถูกตีทิ้งอัตโนมัติอยู่แล้ว
   */
  static readonly CHAIN_MAX_DAYS = 45;
  constructor(
    @InjectRepository(UnassignedReadingEntity)
    private readonly unassignedRepository: Repository<UnassignedReadingEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
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
    const members_id = await this.parseMemberId(dto.members_id);
    const evidence_photo = await this.meterPhotoService.save(
      dto.meter_photo,
      0,
    );

    try {
      return await this.unassignedRepository.save(
        this.unassignedRepository.create({
          villages_id: dto.villages_id ?? null,
          members_id,
          blocked_code: dto.blocked_code?.trim() || null,
          blocked_reason: dto.blocked_reason?.trim() || null,
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

    const rows = await this.unassignedRepository.find({
      where: {
        ...(status ? { status } : { status: 'Pending' as UnassignedStatus }),
        ...(params.villages_id ? { villages_id: params.villages_id } : {}),
      },
      order: { create_date: 'ASC' },
    });

    return await this.withChains(rows);
  }

  // ==========================================
  // มิเตอร์ตัวเดียวกันที่ถ่ายคนละวัน (timeline)
  // ==========================================

  /**
   * เติม `chain` ให้ทุกแถว — ใบก่อนหน้าของมิเตอร์ตัวเดียวกัน
   *
   * ═══ ปัญหาที่แก้ ═══
   *
   * คนเดินจดถ่ายมิเตอร์ตัวเดิมซ้ำคนละวัน (15 ส.ค. ได้ 57, 18 ส.ค. ได้ 90) แล้วทั้งสองใบ
   * ค้างอยู่ในคิวเป็น "ไม่รู้ว่าบ้านไหน" เหมือนกันทั้งคู่ ทั้งที่พอรู้ว่าใบแรกเป็นบ้านไหน
   * ใบที่สองก็ตอบได้ทันทีโดยไม่ต้องเดาใหม่ — มันคือมิเตอร์ตัวเดิมที่เดินไปข้างหน้า
   *
   * ═══ ทำไมไม่เก็บความเชื่อมโยงลงตาราง ═══
   *
   * เพราะคิดสดได้จากข้อมูลที่มีอยู่แล้ว (พิกัด · เวลา · เลขมิเตอร์) และ "ใบก่อนหน้า"
   * เปลี่ยนไปเรื่อย ๆ ตามของที่เข้ามาใหม่/ถูกตีทิ้ง คอลัมน์ที่จดไว้จะค้างชี้ของเก่า
   * แล้วต้องมีโค้ดตามล้างทุกเส้นทาง — ซึ่งจุดที่ลืมจะเงียบ ไม่ error
   *
   * ผลพลอยได้: พอจับคู่ใบแรกเสร็จ (status = Assigned + มี members_id) ใบที่สอง
   * จะเห็นบ้านนั้นทันทีในรอบถัดไปโดยไม่ต้องมีโค้ดวิ่งไปอัปเดตใครเลย
   */
  private async withChains(rows: UnassignedReadingEntity[]) {
    if (rows.length === 0) return [];

    const since = new Date();
    since.setDate(
      since.getDate() - (UnassignedReadingsService.CHAIN_MAX_DAYS + 7),
    );

    // ใบที่เอามาเทียบต้องรวม "ที่จับคู่ไปแล้ว" ด้วย — นั่นแหละคือใบที่รู้บ้านแล้ว
    // ส่วนใบที่ถูกตีทิ้งคือใบที่คนตัดสินแล้วว่าใช้ไม่ได้ เอามาเชื่อมต่อไม่ได้
    const pool = await this.unassignedRepository.find({
      where: { create_date: MoreThanOrEqual(since), status: Not('Discarded') },
    });

    const memberIds = [
      ...new Set(
        pool.map((row) => row.members_id).filter((id): id is number => !!id),
      ),
    ];
    const members = memberIds.length
      ? await this.memberRepository.findBy({ id: In(memberIds) })
      : [];
    const memberById = new Map(members.map((member) => [member.id, member]));

    return rows.map((row) => ({
      ...row,
      chain: this.chainOf(row, pool, memberById),
    }));
  }

  /** เวลาที่ใช้เรียงไทม์ไลน์ — EXIF หายบ่อย ต้องมีตัวสำรองเสมอ */
  private timelineAt(row: UnassignedReadingEntity): number {
    return new Date(row.captured_at ?? row.create_date).getTime();
  }

  /**
   * ใบก่อนหน้าของมิเตอร์ตัวเดียวกัน — null เมื่อไม่มีอะไรที่ชี้ขาดได้
   *
   * ═══ เกณฑ์ (ต้องผ่านครบทุกข้อ) ═══
   *
   *   1. มีเลขมิเตอร์ทั้งคู่ — ไม่มีเลขก็เทียบไม่ได้ว่ามิเตอร์เดินไปข้างหน้าไหม
   *   2. มีพิกัดทั้งคู่ และห่างกันไม่เกิน CHAIN_NEAR_M — ขาดพิกัดคือ "ไม่รู้" ไม่ใช่ "ใช่"
   *   3. ใบก่อนถ่าย**ก่อนจริง** เวลาเท่ากันเป๊ะ = แยกไม่ออกว่าใบไหนมาก่อน
   *   4. เลขไม่ลดลง — มิเตอร์เดินหน้าอย่างเดียว เลขที่ลดลงแปลว่าคนละตัว
   *   5. จำนวนหลักตรงกัน (เมื่อรู้ทั้งคู่) — คนละจำนวนหลักคือคนละรุ่น คนละตัวแน่นอน
   *   6. ห่างกันไม่เกิน CHAIN_MAX_DAYS
   *
   * เลือก "ใบที่ถ่ายก่อนหน้าที่สุดเท่าที่ใกล้ที่สุด" คือใบที่เวลาชิดที่สุด — เพราะสิ่งที่
   * ต้องการคือข้อต่อถัดไปของโซ่ ไม่ใช่ต้นโซ่ ถ้ามีสองใบเวลาเท่ากันเป๊ะ = ตอบไม่ได้ คืน null
   *
   * ⚠️ ด่านนี้ตอบว่า "น่าจะเป็นมิเตอร์ตัวเดียวกัน" **ไม่ได้ตอบว่าเป็นบ้านไหน** —
   *    มิเตอร์ที่ติดกันบนกำแพงเดียวกันห่างกัน 30 ซม. ซึ่งต่ำกว่าความคลาดเคลื่อนของพิกัด
   *    หลายสิบเท่า เกณฑ์ข้อ 2 จึงแยกมันไม่ออก ตัวที่กันเรื่องนี้คือคนที่กดยืนยัน
   *    (ดู cluster_group_id ที่ส่งไปให้หน้าเว็บขึ้นคำเตือน)
   */
  private chainOf(
    row: UnassignedReadingEntity,
    pool: UnassignedReadingEntity[],
    memberById: Map<number, MemberEntity>,
  ): ChainLink | null {
    if (row.meter_unit === null) return null;
    if (row.latitude === null || row.longitude === null) return null;

    const unit = Number(row.meter_unit);
    const at = this.timelineAt(row);
    const here = {
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    };

    let best: { row: UnassignedReadingEntity; distance: number } | null = null;
    let tied = false;

    for (const other of pool) {
      if (other.id === row.id) continue;
      if (other.meter_unit === null) continue;
      if (other.latitude === null || other.longitude === null) continue;

      const otherUnit = Number(other.meter_unit);
      if (otherUnit > unit) continue;

      if (
        row.meter_digits !== null &&
        other.meter_digits !== null &&
        Number(row.meter_digits) !== Number(other.meter_digits)
      ) {
        continue;
      }

      const otherAt = this.timelineAt(other);
      if (otherAt >= at) continue;

      const days = (at - otherAt) / 86_400_000;
      if (days > UnassignedReadingsService.CHAIN_MAX_DAYS) continue;

      const distance = PhotoMetadataService.distanceMeters(here, {
        latitude: Number(other.latitude),
        longitude: Number(other.longitude),
      });
      if (distance > UnassignedReadingsService.CHAIN_NEAR_M) continue;

      if (!best) {
        best = { row: other, distance };
        continue;
      }

      const bestAt = this.timelineAt(best.row);
      if (otherAt > bestAt) {
        best = { row: other, distance };
        tied = false;
      } else if (otherAt === bestAt) {
        // สองใบถ่ายเวลาเดียวกันเป๊ะ = ตอบไม่ได้ว่าใบไหนคือข้อต่อก่อนหน้า
        tied = true;
      }
    }

    if (!best || tied) return null;

    const member = best.row.members_id
      ? (memberById.get(best.row.members_id) ?? null)
      : null;

    return {
      id: best.row.id,
      captured_at: best.row.captured_at,
      meter_unit: Number(best.row.meter_unit),
      usage_unit: unit - Number(best.row.meter_unit),
      days_apart:
        Math.round(((at - this.timelineAt(best.row)) / 86_400_000) * 10) / 10,
      distance_m: Math.round(best.distance),
      status: best.row.status,
      members_id: best.row.members_id,
      house_no: member?.house_no ?? null,
      cluster_group_id: member?.cluster_group_id ?? null,
    };
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

    const [withChain] = await this.withChains([row]);

    return {
      ...withChain,
      candidates: candidates.slice(0, 5),
      suggested: await this.suggestedMember(row, billing_month, billing_year),
    };
  }

  /**
   * บ้านที่คนหน้างานเลือกไว้ พร้อมเลขตั้งต้นของบ้านนั้น — null เมื่อเป็นรูปกำพร้าแท้ ๆ
   *
   * ═══ ทำไมไม่หยิบจาก candidates ที่คิดไว้แล้ว ═══
   *
   * candidates คัดจาก "เลขที่จดเข้ากับบ้านไหนได้บ้าง" ส่วนแถวที่เข้าคิวเพราะด่านตีกลับ
   * คือแถวที่เลขมัน **ไม่เข้า** พอดี (หน่วยพุ่ง / ต่ำกว่าเดือนก่อน) บ้านที่คนหน้างานยืนอยู่หน้ามัน
   * จึงมักไม่ติดอันดับ — ซึ่งเป็นเรื่องปกติของเคสนี้ ไม่ใช่สัญญาณว่าเลือกบ้านผิด
   * ดึงมาตรง ๆ จากทะเบียนบ้านจึงถูกต้องกว่า และคนตรวจยังเห็นตัวเลขครบพอจะตัดสินเอง
   */
  private async suggestedMember(
    row: UnassignedReadingEntity,
    billing_month: string,
    billing_year: string,
  ) {
    if (!row.members_id) return null;

    const member = await this.memberRepository.findOneBy({
      id: row.members_id,
    });
    if (!member) return null;

    const baseline = await this.billsService.previousUnitsForMembers(
      [member.id],
      billing_month,
      billing_year,
    );
    const previous_unit = baseline.get(member.id)?.previous_unit ?? 0;

    return {
      members_id: member.id,
      house_no: member.house_no,
      name: `${member.fname ?? ''} ${member.lname ?? ''}`.trim(),
      previous_unit,
      // null = OCR อ่านไม่ออก ยังคิดหน่วยไม่ได้จนกว่าคนตรวจจะพิมพ์เลขเอง
      usage_unit:
        row.meter_unit === null ? null : Number(row.meter_unit) - previous_unit,
      cluster_group_id: member.cluster_group_id,
      sequence_index: member.sequence_index,
    };
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

    // คนตรวจไม่ได้เลือกบ้านใหม่ = ยืนตามบ้านที่คนหน้างานเลือกไว้ (เคสด่านตีกลับ)
    // ไม่มีทั้งสองทางแปลว่าไม่มีใครรู้ว่าจะออกบิลให้ใคร ต้องบอกตรง ๆ ไม่ใช่ปล่อยไป 500
    const members_id = dto.members_id ?? row.members_id;
    if (!members_id) {
      throw new BadRequestException(
        'ต้องเลือกบ้านเจ้าของรูปก่อนออกบิลครับ — รูปใบนี้ยังไม่มีบ้านที่ระบุไว้',
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
      members_id,
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

  /**
   * บ้านที่ส่งมาต้องมีอยู่จริง — ตรวจตั้งแต่ตอนเข้าคิว ไม่ใช่ตอนกดจับคู่
   *
   * แถวนี้จะไปนอนในคิวเป็นวัน ๆ กว่าจะมีคนเปิด ถ้าปล่อยเลขบ้านมั่ว ๆ ผ่านเข้ามา
   * คนตรวจจะเจอ error ตอนกดอนุมัติ ในจังหวะที่คนหน้างานเดินออกจากพื้นที่ไปนานแล้ว
   */
  private async parseMemberId(
    value: number | undefined,
  ): Promise<number | null> {
    const id = this.parseOptionalInt(value, 'รหัสบ้าน');
    if (id === null) return null;

    const member = await this.memberRepository.findOneBy({ id });
    if (!member) {
      throw new BadRequestException(`ไม่พบข้อมูลลูกบ้านรหัส ${id} ครับ`);
    }
    return id;
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
