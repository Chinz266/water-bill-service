import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';
import { MeterReadingEntity } from '../entity/meter-reading.entity'; // เช็ค Path ให้ตรงกับโครงสร้างโฟลเดอร์ของคุณนะครับ
import { AdminEntity } from '../entity/admin.entity';
import { MemberEntity } from '../entity/member.entity';
import { CreateMeterReadingDto } from '../dto/create-meter-reading.dto';
import { PhotoMetadataService } from './photo-metadata.service';

/**
 * กรอบที่โมเดลชี้ว่าแถวตัวเลขสีดำอยู่ตรงไหน — สัดส่วน 0-1 ของภาพ ไม่ใช่พิกเซล
 *
 * ส่งเป็นสัดส่วนเพราะหน้าเว็บย่อรูปลงก่อนแสดงเสมอ พิกเซลของภาพต้นฉบับจึงใช้ตรง ๆ ไม่ได้
 * (และเลขจะผิดทันทีที่ใครเปลี่ยนขนาดที่ย่อ) สัดส่วนคูณกับขนาดที่แสดงจริงได้เลย
 *
 * ⚠️ เป็นพิกัดของ "ภาพตามที่เก็บในไฟล์" — vision service ไม่หมุนภาพตาม EXIF Orientation
 *    รูปมือถือที่ถ่ายแนวตั้งจะมีกรอบเอียง 90 องศาเทียบกับที่คนเห็น หน้าเว็บต้องหมุนกรอบ
 *    ตาม EXIF ก่อนใช้เสมอ
 */
export interface MeterCropBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 'digits' = กรอบของเลขสีดำ (แม่นกว่า), 'border' = ทั้งแถบเลขมิเตอร์ตอนอ่านหลักไม่ได้ */
  source: 'digits' | 'border';
}

@Injectable()
export class MeterReadingsService {
  private readonly logger = new Logger(MeterReadingsService.name);
  private readonly visionServiceUrl: string;

  constructor(
    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,
    @InjectRepository(AdminEntity)
    private readonly adminRepository: Repository<AdminEntity>,
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly photoMetadataService: PhotoMetadataService,
  ) {
    // URL ของ Python vision service (best.pt) ตั้งค่าผ่าน .env ได้
    this.visionServiceUrl = this.configService.get<string>(
      'VISION_SERVICE_URL',
      'http://127.0.0.1:8000',
    );
  }

  // ==========================================
  // --- ส่วนฟังก์ชัน CRUD ปกติ ---
  // ==========================================
  async create(createMeterReadingDto: CreateMeterReadingDto) {
    // meter_readings.create_by / members_id1 ติด Foreign Key กับ admin.id และ members.id
    // ถ้าไม่เช็คก่อน MySQL จะโยน ER_NO_REFERENCED_ROW_2 ออกมาเป็น 500 ที่อ่านไม่รู้เรื่อง
    const { create_by, members_id } = createMeterReadingDto;

    if (create_by !== undefined && create_by !== null) {
      const admin = await this.adminRepository.findOneBy({ id: create_by });
      if (!admin) {
        throw new BadRequestException(
          `ไม่พบผู้ดูแลระบบรหัส ${create_by} กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่อีกครั้ง`,
        );
      }
    }

    const member = await this.memberRepository.findOneBy({ id: members_id });
    if (!member) {
      throw new BadRequestException(`ไม่พบข้อมูลลูกบ้านรหัส ${members_id}`);
    }

    const newReading = this.meterReadingRepository.create({
      ...createMeterReadingDto,
      // create_date ต้องเซ็ตเอง ดูหมายเหตุใน MeterReadingEntity
      create_date: new Date(),
    });
    return await this.meterReadingRepository.save(newReading);
  }

  async findAll() {
    return await this.meterReadingRepository.find({
      order: { reading_date: 'DESC' },
    });
  }

  async findByMember(memberId: number) {
    return await this.meterReadingRepository.find({
      where: { members_id: memberId },
      order: { reading_date: 'DESC' },
    });
  }

  // ==========================================
  // --- ส่วนฟังก์ชัน OCR (เรียกโมเดล YOLO best.pt ผ่าน Python service) ---
  // ==========================================

  /**
   * จำนวนหลักที่โมเดลเห็นบนหน้าปัด — นับจาก string ดิบเท่านั้น
   *
   * ห้ามนับจากตัวเลขที่แปลงแล้ว เพราะ Number('00025') = 25 ซึ่งเหลือ 2 หลัก
   * ทั้งที่หน้าปัดมี 5 หลัก ค่าที่ได้จะเปลี่ยนไปมาตามเลขที่มิเตอร์เดินไปถึง
   * แล้วใช้เทียบกับเดือนก่อนไม่ได้เลย
   *
   * คืน null เมื่อไม่มีตัวเลขให้นับ — ผู้เรียกต้องถือว่า "ไม่รู้" ไม่ใช่ "0 หลัก"
   */
  private countDigits(raw: string | null | undefined): number | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    return digits.length > 0 ? digits.length : null;
  }

  /**
   * รับกรอบจาก vision service เท่าที่ใช้ได้จริง — ที่เหลือถือว่าไม่มี
   *
   * ค่านี้เดินทางไปจบที่การคูณกับขนาดภาพบนหน้าเว็บ ค่าที่หลุดกรอบ 0-1 หรือไม่ใช่ตัวเลข
   * จะกลายเป็นกรอบครอปที่วางนอกรูปหรือกว้างเป็นศูนย์ ซึ่งดูเหมือนแอปพังทั้งที่ต้นเหตุ
   * อยู่คนละ service — ตอบว่า "ไม่มีกรอบ" แล้วให้แอปใช้กรอบกลางภาพตามเดิมชัดเจนกว่า
   */
  private normalizeCropBox(raw: unknown): MeterCropBox | null {
    const box = raw as Partial<MeterCropBox> | null | undefined;
    if (!box) return null;

    const { x, y, w, h } = box;
    const inRange = [x, y, w, h].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    );
    if (!inRange) return null;
    if (x! < 0 || y! < 0 || w! <= 0 || h! <= 0) return null;
    if (x! + w! > 1.0001 || y! + h! > 1.0001) return null;

    return {
      x: x!,
      y: y!,
      w: w!,
      h: h!,
      source: box.source === 'border' ? 'border' : 'digits',
    };
  }

  async extractMeterUnit(imageBuffer: Buffer) {
    const startTime = Date.now();
    this.logger.log('Starting water meter reading via YOLO vision service...');

    // อ่าน EXIF จาก buffer ต้นฉบับก่อนส่งต่อให้ใคร — วันเวลาและพิกัดที่กล้องบันทึกไว้
    // ต้องมาก่อน request ไป vision service เผื่อฝั่งนั้นล่มก็ยังได้ข้อมูลส่วนนี้
    const photo_taken = this.photoMetadataService.read(imageBuffer);

    try {
      // เตรียม multipart form ส่งรูปไปให้ Python service
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: 'meter.jpg',
        contentType: 'application/octet-stream',
      });

      const response = await firstValueFrom(
        this.httpService.post(`${this.visionServiceUrl}/detect`, form, {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 30000,
        }),
      );

      const data = response.data as {
        success: boolean;
        read_unit: string | null;
        integer_part: string | null;
        decimal_part: string | null;
        full_reading: string | null;
        /** ความมั่นใจของหลักที่อ่อนที่สุด — ตัวที่เอาไปเป็นด่านจริง */
        confidence: number;
        /** ค่าเฉลี่ยของทุกหลัก — ดูภาพรวมได้ แต่ห้ามเอามาเป็นด่าน (กลบหลักที่ไม่ชัด) */
        confidence_avg?: number;
        digit_count?: number;
        /** กรอบแถวตัวเลขสำหรับตั้งกรอบครอปให้อัตโนมัติ — null เมื่อโมเดลไม่เห็นอะไรเลย */
        crop_box?: MeterCropBox | null;
        message: string;
      };

      if (data.success && data.read_unit) {
        // padStart(7,'0') เพื่อคงรูปแบบเดิมที่ frontend คาดหวัง (เลขมิเตอร์ 7 หลัก)
        const paddedDigits = data.read_unit.padStart(7, '0');
        this.logger.log(
          `Reading OK: "${data.full_reading}" (full: ${paddedDigits}, ` +
            `decimal: ${data.decimal_part}, conf: ${data.confidence}) in ${Date.now() - startTime}ms`,
        );
        return {
          success: true,
          // 🌟 ต้องเป็น "ส่วนจำนวนเต็ม" (เลขสีดำบนหน้าปัด = ลูกบาศก์เมตร) เท่านั้น
          //    ของเดิมส่ง full_reading ซึ่งรวมเลขทศนิยม (เข็มแดง) มาด้วย
          //    มิเตอร์ที่อ่านได้ 25.312 จึงกลายเป็น 25312 — ใหญ่เกินจริง 1,000 เท่า
          //    หน้าเว็บเอาค่านี้ไป Math.round() แล้วส่งเป็น current_unit ตรง ๆ
          //    (meter-cropper.ts) ไม่ได้แปลงอะไรเพิ่ม ตัวเลขผิดจึงกลายเป็นยอดเงินผิดทันที
          read_unit: data.integer_part ?? data.full_reading,
          // ส่งเลขดิบไปด้วยเผื่อหน้าเว็บอยากโชว์ทศนิยมให้คนตรวจเทียบกับหน้าปัด
          integer_part: data.integer_part ?? data.read_unit,
          decimal_part: data.decimal_part,
          full_reading: data.full_reading,
          // จำนวนหลักบนหน้าปัด นับจาก string ก่อนแปลงเป็นตัวเลข ไม่งั้นศูนย์นำหน้าหายไป
          // ใช้เทียบกับครั้งก่อนของบ้านเดียวกัน เพื่อจับเคส OCR อ่านหลักหาย/หลักเกิน
          meter_digits: this.countDigits(data.integer_part ?? data.read_unit),
          // 🌟 ค่านี้คือความมั่นใจของ "หลักที่อ่อนที่สุด" ไม่ใช่ค่าเฉลี่ย (main.py คืนมาแบบนี้)
          //    เลขมิเตอร์ผิดหลักเดียวก็ผิดทั้งจำนวน ค่าเฉลี่ยจึงกลบหลักที่ไม่ชัดจนมองไม่เห็น
          //    หน้าเว็บต้องส่งค่านี้ต่อไปกับ POST /bills/scan เป็น read_confidence
          //    ไม่งั้นด่านที่จับ "อ่านผิดค่าโดยจำนวนหลักไม่เปลี่ยน" จะไม่ทำงานเลย
          confidence: data.confidence,
          // ค่าเฉลี่ยกับจำนวนหลักที่โมเดลเห็น — ไว้โชว์ให้คนตรวจดูภาพรวม ไม่ใช่ด่าน
          confidence_avg: data.confidence_avg ?? null,
          digit_count: data.digit_count ?? null,
          // กรอบสำหรับตั้ง auto-crop บนแอป — ไม่เกี่ยวกับเลขที่อ่านได้ในรอบนี้
          crop_box: this.normalizeCropBox(data.crop_box),
          photo_taken,
          message: 'สกัดค่าตัวเลขสำเร็จ',
        };
      }

      this.logger.warn(
        `Vision service found no digits. Total time: ${Date.now() - startTime}ms`,
      );
      // คืนคีย์ชุดเดียวกับตอนสำเร็จ (เป็น null) ผู้เรียกจะได้ไม่ต้องเดาว่ามีฟิลด์ไหนบ้าง
      return {
        success: false,
        read_unit: null,
        integer_part: null,
        decimal_part: null,
        full_reading: null,
        meter_digits: null,
        confidence: 0,
        // อ่านเลขไม่ได้ แต่ถ้าโมเดลยังเห็นกรอบมิเตอร์ก็ส่งไปให้คนลากต่อได้
        crop_box: this.normalizeCropBox(data.crop_box),
        photo_taken,
        message:
          data.message ||
          'วิเคราะห์ภาพแล้ว แต่ได้ตัวเลขไม่ครบถ้วน กรุณาถ่ายให้ชัดเจนขึ้น',
      };
    } catch (error) {
      // แยกกรณีต่อ Python service ไม่ติด ออกจาก error อื่นๆ เพื่อ debug ง่าย
      const err = error as { code?: string; message?: string; stack?: string };
      if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
        this.logger.error(
          `ไม่สามารถเชื่อมต่อ Vision service ที่ ${this.visionServiceUrl} ได้ ` +
            `(ตรวจสอบว่ารัน Python service อยู่หรือไม่): ${err.message}`,
        );
        throw new BadRequestException(
          'ระบบอ่านมิเตอร์ยังไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้ง',
        );
      }

      this.logger.error(
        'An error occurred during water meter reading:',
        err.stack || err.message,
      );
      throw new BadRequestException(
        'ระบบวิเคราะห์รูปภาพมีปัญหา กรุณาลองใหม่อีกครั้ง',
      );
    }
  }
}
