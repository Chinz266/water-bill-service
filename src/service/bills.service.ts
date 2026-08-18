import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, In, IsNull, Not, Repository } from 'typeorm';
import { BillEntity, PAYMENT_STATUSES } from 'src/entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity'; // ปรับ Path ให้ตรงกับโฟลเดอร์ของคุณ
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { VillageEntity } from '../entity/village.entity';
import {
  ProvinceEntity,
  DistrictEntity,
  SubdistrictEntity,
} from '../entity/location.entity';
import { BillArrearsEntity } from '../entity/bill-arrears.entity';
import { MeterEntity } from '../entity/meter.entity';
import { CreateBillDto } from 'src/dto/create-bill.dto';
import { CreateBillFromScanDto } from 'src/dto/create-bill-from-scan.dto';
import { MeterPhotoService } from './meter-photo.service';
import { PhotoMetadataService } from './photo-metadata.service';
import { PendingFlag, ReadingFlagsService } from './reading-flags.service';
import { ReadingLogsService } from './reading-logs.service';
import { AdminRole } from 'src/auth/auth.constants';

/**
 * คอลัมน์ดิบที่ billDetailQuery() ดึงมาจาก join (ชื่อ = alias_ชื่อคอลัมน์)
 * decimal ของ MySQL กลับมาเป็น string จึงรับไว้ทั้งสองแบบ
 */
interface BillDetailRow {
  rate_price_per_unit?: string | number | null;
  reading_id?: number | null;
  reading_reading_date?: Date | null;
  reading_meter_unit?: number | null;
  reading_evidence_photo?: string | null;
  member_id?: number | null;
  member_house_no?: string | null;
  member_fname?: string | null;
  member_lname?: string | null;
  member_phone?: string | null;
  village_id?: number | null;
  village_village_name?: string | null;
  village_village_no?: string | null;
  village_zip_code?: string | null;
  subdistrict_name_in_thai?: string | null;
  district_name_in_thai?: string | null;
  province_name_in_thai?: string | null;
}

/**
 * เกณฑ์ตัดสิน "หน่วยน้ำผิดปกติ" ของหมู่บ้านหนึ่ง
 *
 * แยกเป็น 2 ระดับด้วยเจตนาคนละอย่าง:
 *   warnRatio  — ติดธงไว้ให้ไล่ดูย้อนหลัง ไม่รบกวนคนหน้างาน
 *   spikeRatio — บล็อก 409 ต้องกดยืนยัน
 */
export interface UsageThresholds {
  warnRatio: number;
  spikeRatio: number;
  /** ต่ำกว่านี้ (หน่วย/เดือน) ไม่ถือว่าผิดปกติแม้เกินอัตราส่วน */
  floor: number;
  /** เพดานตายตัวสำหรับบ้านที่ยังไม่มีประวัติให้เทียบ */
  hardCap: number;
}

/**
 * รหัสของด่านที่บล็อกการออกบิล — ส่งไปกับ body ของ error ทุกครั้ง
 *
 * ═══ ทำไมต้องมี ═══
 *
 * หน้าเว็บต้องรู้ว่า 409 ที่ได้มาเป็นด่านไหน เพื่อขึ้นปุ่มยืนยันให้ถูกตัว
 * ก่อนหน้านี้แยกด้วยการหาคำในข้อความไทย (`error.includes('หลัก')`) ซึ่งพังทันที
 * ที่มีด่านใหม่ที่ข้อความบังเอิญมีคำเดียวกัน — และข้อความก็ถูกแก้บ่อยกว่าโค้ด
 *
 * ค่าพวกนี้เป็นส่วนหนึ่งของสัญญา API แล้ว **ห้ามเปลี่ยนชื่อ** โดยไม่แก้หน้าเว็บด้วย
 * (ข้อความภาษาไทยแก้ได้อิสระ เพราะไม่มีใครเอาไปเทียบอีกแล้ว)
 */
export const BILL_ERROR_CODES = {
  /** หน่วยน้ำสูงผิดปกติ → `confirm_high_usage` */
  HIGH_USAGE: 'HIGH_USAGE',
  /** จำนวนหลักบนหน้าปัดเปลี่ยน → `confirm_digit_change` */
  DIGIT_CHANGE: 'DIGIT_CHANGE',
  /** OCR อ่านไม่ชัด → `confirm_low_confidence` */
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  /** พิกัดซ้ำเป๊ะทุกทศนิยม → `confirm_duplicate_location` */
  DUPLICATE_LOCATION: 'DUPLICATE_LOCATION',
  /** รูปถ่ายไว้นานเกิน 30 วัน → `confirm_stale_photo` */
  STALE_PHOTO: 'STALE_PHOTO',
  /** เลขต่ำกว่าเดือนก่อน → `confirm_meter_reset` */
  METER_ROLLBACK: 'METER_ROLLBACK',
  /** มีบิลเดือนนี้แล้ว → `replace` */
  BILL_EXISTS: 'BILL_EXISTS',

  // ═══ ด่านที่ "ไม่มีปุ่มยืนยัน" — หน้าเว็บต้องไม่ขึ้นปุ่มให้กดข้าม ═══

  /** ไฟล์รูปเดิมถูกอัปซ้ำ (captured_at ตรงเป๊ะ) — ต้องถ่ายใหม่เท่านั้น */
  PHOTO_REUSED: 'PHOTO_REUSED',
  /** ถ่ายรัวหลายใบที่จุดเดียวกันในไม่กี่วินาที — ต้องเดินไปถ่ายที่มิเตอร์จริง */
  BURST_PHOTO: 'BURST_PHOTO',
  /** เวลาถ่ายเป็นอนาคต — นาฬิกาเครื่องเพี้ยนหรือถูกแก้ ต้องตั้งเวลาให้ตรงก่อน */
  FUTURE_TIMESTAMP: 'FUTURE_TIMESTAMP',
  /** กรอกเลขเองแต่ไม่แนบรูปหน้าปัด — ไม่มีอะไรตรวจเลขได้เลย */
  MANUAL_PHOTO_REQUIRED: 'MANUAL_PHOTO_REQUIRED',
  /** บิลเดือนนี้จ่ายเงินแล้ว — ต้องปรับสถานะกลับเป็นค้างชำระก่อน */
  BILL_PAID: 'BILL_PAID',
  /** มีบิลเดือนที่ใหม่กว่าอยู่ — ต้องลบใบนั้นก่อน */
  LATER_BILL_EXISTS: 'LATER_BILL_EXISTS',
  /**
   * เลขที่จดเข้ากับบ้านอีกหลังในกลุ่มมิเตอร์เดียวกันมากกว่า — จดสลับตัวซ้าย/ตัวขวา
   * ไม่มีปุ่มยืนยัน เพราะทางแก้คือ "เลือกบ้านให้ถูกหลัง" ไม่ใช่ปล่อยเลขผิดผ่านไป
   */
  CLUSTER_SEQUENCE_MISMATCH: 'CLUSTER_SEQUENCE_MISMATCH',
} as const;

export type BillErrorCode =
  (typeof BILL_ERROR_CODES)[keyof typeof BILL_ERROR_CODES];

/**
 * รหัสด่านของ **PATCH /bills/:id/reading** โดยเฉพาะ
 *
 * ⚠️ ตัวพิมพ์เล็ก และเป็น 400 ไม่ใช่ 409 — ต่างจาก BILL_ERROR_CODES ข้างบนโดยตั้งใจ
 *    เพราะเป็นสัญญาที่ตกลงไว้กับหน้าแก้บิลแล้ว (หน้าเว็บอ่าน `code` ตัวนี้เพื่อเปิด
 *    ปุ่มยืนยัน ถ้าไม่มี code จะขึ้นเป็น error ธรรมดา) ห้ามเปลี่ยนโดยไม่แก้หน้าเว็บด้วย
 *
 * มีแค่สองตัวเพราะทางแก้บิลเปิดปุ่มยืนยันแค่สองด่านนี้ — ด่านอื่น (จำนวนหลัก,
 * ความมั่นใจ OCR) ไม่มีความหมายตรงนี้ เลขที่ส่งมาคือเลขที่คนพิมพ์เองอยู่แล้ว
 */
export const READING_EDIT_ERROR_CODES = {
  /** หน่วยน้ำหลังแก้สูงผิดปกติ → `confirm_high_usage` */
  HIGH_USAGE: 'high_usage',
  /** เลขใหม่ต่ำกว่าเลขตั้งต้น → `confirm_meter_reset` */
  METER_RESET: 'meter_reset',
} as const;

/**
 * body ของ error ที่มีทั้งข้อความไทยและรหัสให้เครื่องอ่าน
 *
 * คง `message` ไว้ที่เดิมเป๊ะ ๆ เพราะ extractErrorMessage() ของหน้าเว็บอ่านจากตรงนั้น
 * — เพิ่ม `code` เข้าไปเฉย ๆ หน้าเว็บรุ่นเก่าจึงไม่พังระหว่างที่ยังไม่ได้อัปเดต
 */
function billError(code: BillErrorCode, message: string, statusCode: number) {
  return { statusCode, message, code };
}

@Injectable()
export class BillsService {
  constructor(
    @InjectRepository(BillEntity)
    private readonly billRepository: Repository<BillEntity>,

    @InjectRepository(WaterRateEntity)
    private readonly waterRateRepository: Repository<WaterRateEntity>, // เรียกใช้ตารางเรทค่าน้ำ

    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,

    // ใช้หา villages_id ของบ้าน เพื่อไปเอารอบชำระของหมู่บ้านนั้นมาคิด due_date
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,

    @InjectRepository(VillageEntity)
    private readonly villageRepository: Repository<VillageEntity>,

    private readonly meterPhotoService: MeterPhotoService,

    // ยอดค้างที่ทบเข้าบิลใบใหม่ — เก็บรายใบเพราะตอนรับเงินต้องปิดใบเก่าทุกใบ
    // ที่ถูกทบพร้อมกัน ไม่งั้นยอดเดิมจะถูกทบซ้ำในเดือนถัดไป
    @InjectRepository(BillArrearsEntity)
    private readonly billArrearsRepository: Repository<BillArrearsEntity>,

    // ทะเบียนมิเตอร์ — ใช้หา "หน่วยค้างของมิเตอร์ตัวเก่าที่ยังไม่ได้คิดเงิน"
    @InjectRepository(MeterEntity)
    private readonly meterRepository: Repository<MeterEntity>,

    // ธงที่ติดไว้กับการจด — เขียนในทรานแซกชันเดียวกับบิลเสมอ
    private readonly readingFlagsService: ReadingFlagsService,

    // ร่องรอยการแก้เลขมิเตอร์หลังออกบิล — เขียนในทรานแซกชันเดียวกับการแก้เสมอ
    private readonly readingLogsService: ReadingLogsService,
  ) {}

  /**
   * บิลของบ้านหลังนี้ในเดือน/ปีที่ระบุ (ถ้ามี)
   *
   * ตาราง bills ไม่มี members_id ต้องไล่ผ่าน meter_readings เอา
   * ด้วยเหตุนี้จึงบังคับ "1 บ้าน = 1 บิลต่อเดือน" ด้วย unique index ระดับ DB ไม่ได้
   * ต้องกันที่ชั้น service แทน
   */
  async findByMemberAndMonth(
    membersId: number,
    billing_month: string,
    billing_year: string,
  ) {
    // ⚠️ ต้องเทียบเป็น "ตัวเลข" ไม่ใช่ string
    //    billing_month เป็น varchar(10) ที่เก็บ '08' แต่ '8' กับ '08' คือเดือนเดียวกัน
    //    ที่อื่นทั้งไฟล์เทียบผ่าน monthKey() ซึ่ง Number() ให้อยู่แล้ว ตรงนี้จึงเป็นจุดเดียว
    //    ที่ยังเทียบ string ตรง ๆ — พอหน้าเว็บส่ง '8' มา ด่านกันบิลซ้ำจะมองไม่เห็นใบเดิม
    //    แล้วออกบิลใบที่สองของเดือนเดียวกันให้เงียบ ๆ (ลูกบ้านโดนเก็บสองรอบ)
    //    CAST ยังครอบแถวเก่าที่เผลอบันทึกแบบไม่เติมศูนย์ไปแล้วด้วย
    const { month, year } = this.normalizeBillingPeriod(
      billing_month,
      billing_year,
    );

    return await this.billRepository
      .createQueryBuilder('bill')
      .innerJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .where('reading.members_id1 = :membersId', { membersId })
      .andWhere('CAST(bill.billing_month AS UNSIGNED) = :month', { month })
      .andWhere('CAST(bill.billing_year AS UNSIGNED) = :year', { year })
      .getOne();
  }

  /** '2026' + '07' → 202607 ใช้เทียบว่าเดือนไหนมาก่อนมาหลัง (เทียบ string ตรง ๆ จะพลาดตอนข้ามปี) */
  private monthKey(year: string | number, month: string | number): number {
    return Number(year) * 100 + Number(month);
  }

  /**
   * เดือนแบบนับต่อเนื่องไม่ขาดตอน ('2026' + '01' → 24313) ใช้ **ลบกัน** เพื่อหาจำนวนเดือน
   *
   * ต่างจาก monthKey ที่ใช้เทียบลำดับได้อย่างเดียว — 202601 - 202512 = 89 ไม่ใช่ 1
   * เพราะช่องว่างระหว่างปีใน monthKey มี 88 ค่าที่ไม่มีจริง
   */
  private monthIndex(year: string | number, month: string | number): number {
    return Number(year) * 12 + Number(month);
  }

  /** เรียงบิลจากเดือนเก่าไปใหม่ */
  private sortByMonth(bills: BillEntity[]): BillEntity[] {
    return [...bills].sort(
      (a, b) =>
        this.monthKey(a.billing_year, a.billing_month) -
        this.monthKey(b.billing_year, b.billing_month),
    );
  }

  /** บิลทุกใบของบ้านหลังนี้ เรียงจากเดือนเก่าไปใหม่ */
  private async billsOfMember(membersId: number) {
    const bills = await this.billRepository
      .createQueryBuilder('bill')
      .innerJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .where('reading.members_id1 = :membersId', { membersId })
      .getMany();

    return this.sortByMonth(bills);
  }

  /**
   * บิลของหลายบ้านพร้อมกันในคิวรีเดียว แยกเป็น Map ตามบ้าน
   *
   * หน้าอัปรูปทีละหลายใบต้องรู้เลขตั้งต้นของ "ทุกบ้าน" เพื่อเอามาจับคู่ว่ารูปไหนของใคร
   * ถ้าวนเรียก billsOfMember() ทีละหลัง 50 บ้านจะกลายเป็น 50 คิวรีต่อการอัปหนึ่งครั้ง
   */
  private async billsOfMembers(
    memberIds: number[],
  ): Promise<Map<number, BillEntity[]>> {
    const grouped = new Map<number, BillEntity[]>();
    if (memberIds.length === 0) return grouped;

    // ตาราง bills ไม่มี members_id ต้องลากมาจาก meter_readings แล้วเลือกเป็นคอลัมน์ raw
    const { entities, raw } = await this.billRepository
      .createQueryBuilder('bill')
      .innerJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .addSelect('reading.members_id1', 'owner_members_id')
      .where('reading.members_id1 IN (:...memberIds)', { memberIds })
      .getRawAndEntities();

    entities.forEach((bill, index) => {
      const row = raw[index] as Record<string, unknown>;
      const owner = Number(row.owner_members_id);
      const list = grouped.get(owner);
      if (list) list.push(bill);
      else grouped.set(owner, [bill]);
    });

    for (const [owner, list] of grouped) {
      grouped.set(owner, this.sortByMonth(list));
    }
    return grouped;
  }

  /**
   * กฎการเลือกเลขตั้งต้น — **จุดเดียวในระบบที่ตัดสินเรื่องนี้**
   *
   * รับข้อมูลที่โหลดมาแล้วเข้ามาตรง ๆ ไม่ยิงคิวรีเอง เพื่อให้ทั้งแบบรายบ้าน
   * (getPreviousUnit) และแบบยกชุด (previousUnitsForMembers) ใช้กฎเดียวกันจริง ๆ
   * ถ้าปล่อยให้ต่างฝ่ายต่างเขียน วันหนึ่งยอดเงินสองทางจะไม่ตรงกันโดยไม่มีใครรู้
   */
  private resolvePreviousUnit(params: {
    /** เรียงเดือนเก่า→ใหม่มาแล้ว */
    bills: BillEntity[];
    /** เรียงวันที่เก่า→ใหม่มาแล้ว */
    readings: MeterReadingEntity[];
    targetKey: number;
    excludeReadingId?: number;
  }): {
    previous_unit: number;
    source: 'bill' | 'registration' | 'none';
    bill: BillEntity | null;
  } {
    const previousBill =
      params.bills
        .filter(
          (b) =>
            this.monthKey(b.billing_year, b.billing_month) < params.targetKey,
        )
        .pop() ?? null;

    if (previousBill) {
      return {
        previous_unit: Number(previousBill.current_unit),
        source: 'bill',
        bill: previousBill,
      };
    }

    // ต้องตัดการจดของรอบนี้ออก ไม่งั้นจะเอาเลขที่เพิ่งสแกนมาเป็นตัวตั้งของตัวเอง (ใช้ไป 0 หน่วย)
    const baseReading = params.readings.find(
      (r) => r.id !== params.excludeReadingId,
    );

    return {
      previous_unit: baseReading ? Number(baseReading.meter_unit) : 0,
      source: baseReading ? 'registration' : 'none',
      bill: null,
    };
  }

  /**
   * เลขตั้งต้นที่ใช้คิดหน่วยน้ำของเดือนที่ระบุ — จุดเดียวที่ตัดสินเรื่องนี้
   * ทั้ง create() และหน้าสแกนเรียกตัวนี้ ตัวเลขบนจอกับยอดที่ออกจริงจะได้ตรงกันเสมอ
   *
   * ลำดับการหา:
   *   1. เลขปิดของบิลใบล่าสุดที่เดือนเก่ากว่า
   *   2. ไม่มีบิลเลย → เลขมิเตอร์ ณ วันลงทะเบียนบ้าน (การจดครั้งแรกสุดของบ้านหลังนี้)
   *   3. ไม่ได้กรอกไว้ตอนลงทะเบียนด้วย → 0
   *
   * ข้อ 2 สำคัญ ถ้าข้ามไปใช้ 0 บ้านที่มิเตอร์เดินมาแล้ว 2,000 หน่วยก่อนเข้าระบบ
   * จะโดนคิดค่าน้ำย้อนหลังทั้ง 2,000 หน่วยในบิลใบแรก
   */
  async getPreviousUnit(
    membersId: number,
    billing_month: string,
    billing_year: string,
    excludeReadingId?: number,
  ): Promise<{
    previous_unit: number;
    source: 'bill' | 'registration' | 'none';
    bill: BillEntity | null;
  }> {
    const bills = await this.billsOfMember(membersId);
    const readings = await this.meterReadingRepository.find({
      where: { members_id: membersId },
      order: { reading_date: 'ASC', id: 'ASC' },
    });

    return this.resolvePreviousUnit({
      bills,
      readings,
      targetKey: this.monthKey(billing_year, billing_month),
      excludeReadingId,
    });
  }

  /**
   * พิกัดอ้างอิงของมิเตอร์แต่ละบ้าน เรียนรู้จากจุดที่เคยไปยืนถ่ายจริง
   *
   * ใช้ **มัธยฐาน** ไม่ใช่ค่าเฉลี่ย เพราะการจดครั้งที่ GPS ยังไม่ fix จะให้พิกัด
   * ผิดไปเป็นกิโล ค่าเฉลี่ยจะถูกลากไปทั้งชุดจากค่าเดียว ส่วนมัธยฐานไม่สะเทือน
   *
   * ต้องมีอย่างน้อย 2 ครั้งถึงจะเชื่อ — ครั้งเดียวแยกไม่ออกว่าเป็นตำแหน่งจริง
   * หรือเป็นครั้งที่ GPS เพี้ยนพอดี
   */
  private static readonly MIN_READINGS_FOR_REFERENCE = 2;

  learnedMeterLocations(readings: MeterReadingEntity[]): Map<
    number,
    {
      latitude: number;
      longitude: number;
      samples: number;
      /**
       * MAD — มัธยฐานของระยะจากจุดกลางถึงแต่ละครั้งที่เคยไปจด (เมตร)
       *
       * ═══ ทำไมต้องมีค่านี้ ═══
       *
       * ก่อนหน้านี้ทุกบ้านใช้รัศมี "ใกล้" เท่ากันหมด (GPS_NEAR_M = 50 ม.) ทั้งที่
       * ความแม่นจริงต่างกันมากตามสภาพหน้างาน — มิเตอร์กลางทุ่งโล่งจับดาวเทียมได้
       * 8 ดวง กระจายไม่ถึง 5 ม. ส่วนมิเตอร์ใต้ชายคาติดกำแพงกระจายได้ถึง 40 ม.
       * รัศมีเดียวกันจึงหลวมเกินไปสำหรับบ้านแรก และคับเกินไปสำหรับบ้านหลัง
       *
       * MAD คือ "รัศมีจริงของบ้านหลังนี้" ที่วัดมาจากข้อมูลของบ้านหลังนั้นเอง
       * ใช้มัธยฐาน ไม่ใช่ส่วนเบี่ยงเบนมาตรฐาน ด้วยเหตุผลเดียวกับจุดกลาง:
       * ครั้งที่ GPS ยังไม่ fix ให้พิกัดผิดเป็นกิโล ซึ่งจะทำให้ SD ระเบิด
       *
       * null = มีตัวอย่างน้อยเกินกว่าจะประเมินการกระจาย
       */
      spread_m: number | null;
    }
  > {
    const byMember = new Map<number, { lat: number[]; lng: number[] }>();

    for (const r of readings) {
      const latitude = Number(r.latitude);
      const longitude = Number(r.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      if (latitude === 0 && longitude === 0) continue;

      const bucket = byMember.get(r.members_id) ?? { lat: [], lng: [] };
      bucket.lat.push(latitude);
      bucket.lng.push(longitude);
      byMember.set(r.members_id, bucket);
    }

    const median = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    };

    const result = new Map<
      number,
      {
        latitude: number;
        longitude: number;
        samples: number;
        spread_m: number | null;
      }
    >();
    for (const [membersId, bucket] of byMember) {
      if (bucket.lat.length < BillsService.MIN_READINGS_FOR_REFERENCE) continue;

      const latitude = median(bucket.lat);
      const longitude = median(bucket.lng);

      // ต้องมีอย่างน้อย 3 จุดถึงจะพูดเรื่องการกระจายได้ — 2 จุดให้ MAD เท่ากับ
      // ครึ่งหนึ่งของระยะระหว่างสองจุดเสมอ ซึ่งเป็นเลขที่ไม่ได้บอกอะไรเลย
      const spread_m =
        bucket.lat.length >= 3
          ? median(
              bucket.lat.map((lat, i) =>
                PhotoMetadataService.distanceMeters(
                  { latitude: lat, longitude: bucket.lng[i] },
                  { latitude, longitude },
                ),
              ),
            )
          : null;

      result.set(membersId, {
        latitude,
        longitude,
        samples: bucket.lat.length,
        spread_m: spread_m === null ? null : Math.round(spread_m * 10) / 10,
      });
    }
    return result;
  }

  /**
   * จำนวนหลักบนหน้าปัดที่แต่ละบ้านอ่านได้ล่าสุด — ใช้จับเคส OCR อ่านหลักหาย/หลักเกิน
   *
   * ไม่ต้องหาค่าที่พบบ่อยที่สุดหรือค่ามัธยฐาน เพราะจำนวนหลักไม่ใช่ค่าที่มี noise
   * แบบพิกัด GPS — มิเตอร์ตัวหนึ่งมีกี่หลักก็เท่านั้นตลอด ค่าที่ต่างออกไปคือความผิดพลาด
   * ไม่ใช่ความคลาดเคลื่อน จึงใช้ "ครั้งล่าสุดที่รู้" ตรง ๆ ซึ่งสะท้อนการเปลี่ยนมิเตอร์ด้วย
   *
   * ข้ามแถวที่เป็น null (การจดที่กรอกมือ ไม่ได้ผ่าน OCR) — ไม่ใช่นับเป็น 0
   */
  knownMeterDigits(readings: MeterReadingEntity[]): Map<number, number> {
    const result = new Map<number, number>();

    // readings เรียงจากเก่าไปใหม่ การทับค่าไปเรื่อย ๆ จึงเหลือค่าล่าสุดของแต่ละบ้าน
    for (const reading of readings) {
      const digits = Number(reading.meter_digits);
      if (!Number.isInteger(digits) || digits <= 0) continue;
      result.set(reading.members_id, digits);
    }

    return result;
  }

  /** การจดมิเตอร์ทั้งหมดของหลายบ้าน — ใช้เรียนรู้พิกัดและหาเลขตั้งต้น */
  async readingsOfMembers(memberIds: number[]): Promise<MeterReadingEntity[]> {
    if (memberIds.length === 0) return [];
    return await this.meterReadingRepository.find({
      where: { members_id: In(memberIds) },
      order: { reading_date: 'ASC', id: 'ASC' },
    });
  }

  /**
   * เลขตั้งต้น + ประวัติการใช้น้ำ ของหลายบ้านพร้อมกัน — ใช้ 3 คิวรีไม่ว่าจะกี่บ้าน
   *
   * ใช้โดยหน้าอัปรูปหลายใบ ซึ่งต้องเอาเลขตั้งต้นของทุกบ้านมาเทียบกับเลขที่ OCR อ่านได้
   * เพื่อหาว่ารูปแต่ละใบเป็นของบ้านไหน
   */
  async previousUnitsForMembers(
    memberIds: number[],
    billing_month: string,
    billing_year: string,
  ): Promise<
    Map<
      number,
      {
        previous_unit: number;
        source: 'bill' | 'registration' | 'none';
        /** หน่วยน้ำที่บ้านนี้เคยใช้ (เฉพาะเดือนก่อนหน้าเดือนเป้าหมาย เรียงเก่า→ใหม่) */
        usage_history: number[];
        /**
         * หน่วยที่บ้านนี้ใช้ตามปกติ — median ของ 6 เดือนล่าสุด (null = ยังไม่มีประวัติ)
         * ต้องคิดด้วย BillsService.usageBaseline() ตัวเดียวกับด่านตอนออกบิลเป๊ะ ๆ
         * ไม่งั้นหน้าอัปรูปจะเสนอบ้านที่พอกดยืนยันจริงแล้วโดนตีกลับเป็น 409
         */
        typical_usage: number | null;
        /** มีบิลของเดือนเป้าหมายอยู่แล้วหรือยัง */
        already_billed: boolean;
      }
    >
  > {
    const period = this.normalizeBillingPeriod(billing_month, billing_year);
    const targetKey = this.monthKey(period.year, period.month);

    const billsByMember = await this.billsOfMembers(memberIds);
    const allReadings = await this.readingsOfMembers(memberIds);

    const readingsByMember = new Map<number, MeterReadingEntity[]>();
    for (const reading of allReadings) {
      const list = readingsByMember.get(reading.members_id);
      if (list) list.push(reading);
      else readingsByMember.set(reading.members_id, [reading]);
    }

    const result = new Map<
      number,
      {
        previous_unit: number;
        source: 'bill' | 'registration' | 'none';
        usage_history: number[];
        typical_usage: number | null;
        already_billed: boolean;
      }
    >();

    for (const membersId of memberIds) {
      const bills = billsByMember.get(membersId) ?? [];
      const resolved = this.resolvePreviousUnit({
        bills,
        readings: readingsByMember.get(membersId) ?? [],
        targetKey,
      });

      const usage_history = bills
        .filter(
          (b) => this.monthKey(b.billing_year, b.billing_month) < targetKey,
        )
        .map((b) => Number(b.usage_unit))
        .filter((u) => u > 0);

      result.set(membersId, {
        previous_unit: resolved.previous_unit,
        source: resolved.source,
        usage_history,
        typical_usage: BillsService.usageBaseline(usage_history),
        already_billed: bills.some(
          (b) => this.monthKey(b.billing_year, b.billing_month) === targetKey,
        ),
      });
    }

    return result;
  }

  /**
   * เดือน/ปีของบิลต้องเป็นเลขที่ใช้งานได้จริง — คืนรูปแบบมาตรฐานกลับไปให้ใช้ต่อ
   *
   * monthKey() แปลงค่าด้วย Number() ตรง ๆ ถ้าได้ '13' หรือ 'ส.ค.' เข้ามา
   * จะกลายเป็น NaN แล้วการเทียบ "เดือนไหนมาก่อนมาหลัง" ทั้งหมดจะ false เงียบ ๆ
   * (NaN เทียบอะไรก็ false) → ด่านกันบิลซ้ำและด่านกันบิลย้อนหลังหลุดพร้อมกัน
   * โปรเจกต์นี้ยังไม่ได้เปิด global ValidationPipe จึงต้องดักเองที่ชั้น service
   *
   * คืน billing_month แบบเติมศูนย์เสมอ ('8' → '08') แล้วบันทึกค่านี้ลงตาราง
   * ไม่ใช่ค่าดิบที่รับมา เพื่อให้ทุกแถวในฐานข้อมูลอยู่ในรูปแบบเดียวกัน
   */
  private normalizeBillingPeriod(
    billing_month: string,
    billing_year: string,
  ): {
    month: number;
    year: number;
    billing_month: string;
    billing_year: string;
  } {
    const month = Number(billing_month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException(
        `เดือนที่ออกบิล "${billing_month}" ไม่ถูกต้อง ต้องเป็นตัวเลข 01-12 ครับ`,
      );
    }

    const year = Number(billing_year);
    const maxYear = new Date().getFullYear() + 1;
    if (!Number.isInteger(year) || year < 2000 || year > maxYear) {
      throw new BadRequestException(
        `ปีที่ออกบิล "${billing_year}" ไม่ถูกต้อง ต้องเป็นปี ค.ศ. ระหว่าง 2000 ถึง ${maxYear} ครับ`,
      );
    }

    return {
      month,
      year,
      billing_month: String(month).padStart(2, '0'),
      billing_year: String(year),
    };
  }

  /** ยอมให้วันที่จดคลาดจากเดือนบิลได้กี่วัน (จดปลายเดือนก่อน / ต้นเดือนถัดไป) */
  private static readonly READING_DATE_TOLERANCE_DAYS = 15;

  /**
   * แปลง reading_date ที่รับมาเป็น Date ที่เชื่อถือได้ — ของเดิมไม่ตรวจอะไรเลย
   *
   * ของเดิมเขียน `new Date(dto.reading_date)` ดิบ ๆ ผลคือ:
   *   - string มั่ว ('เมื่อวาน') → Invalid Date → MySQL เด้งเป็น 500 ที่อ่านไม่รู้เรื่อง
   *   - วันที่อนาคต (2030-12-31) → ผ่านฉลุย บันทึกลงฐานข้อมูลเลย
   *   - reading_date ไม่ผูกกับ billing_month เลย ส่ง 2020-01-01 คู่กับบิลเดือน 08/2026 ได้
   *     ซึ่งทำให้ประวัติการจดเรียงตามวันที่แล้วสลับกับลำดับบิล
   */
  private parseReadingDate(
    raw: string | undefined,
    billing_month: string,
    billing_year: string,
  ): Date {
    if (!raw) return new Date();

    // 'YYYY-MM-DD' ต้องแยกเลขมาสร้างเอง ห้ามโยนเข้า new Date() ตรง ๆ
    // เพราะสเปกกำหนดให้ string รูปแบบนั้นถูกตีความเป็น UTC เที่ยงคืน
    // ขณะที่หน้าต่างวันที่ข้างล่างสร้างด้วยเวลาท้องถิ่น เทียบกันแล้วขอบเคลื่อนไป 1 วัน
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
    const parsed = dateOnly
      ? new Date(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3]),
        )
      : new Date(raw);

    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(
        `วันที่จดมิเตอร์ "${raw}" ไม่ใช่วันที่ที่อ่านได้ กรุณาใช้รูปแบบ ปี-เดือน-วัน เช่น 2026-08-14 ครับ`,
      );
    }

    // ดันเป็นสิ้นวันก่อนเทียบ ไม่งั้นจดตอนบ่ายวันนี้จะถูกนับเป็น "อนาคต"
    // เพราะ new Date('2026-08-14') ได้เที่ยงคืน แต่ new Date() ได้เวลาจริง
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (parsed > endOfToday) {
      throw new BadRequestException(
        `วันที่จดมิเตอร์ (${parsed.toLocaleDateString('th-TH')}) เป็นวันในอนาคต กรุณาตรวจสอบอีกครั้งครับ`,
      );
    }

    const month = Number(billing_month);
    const year = Number(billing_year);
    const tolerance = BillsService.READING_DATE_TOLERANCE_DAYS;

    // Date ปัดวันที่เกินขอบเดือนให้เองอัตโนมัติ จึงเขียนบวก/ลบตรง ๆ ได้เลย
    //   earliest: วันที่ 1 ของเดือนบิล ถอยหลัง 15 วัน  (08/2026 → 16 ก.ค. 2026)
    //   latest:   วันสุดท้ายของเดือนบิล บวกอีก 15 วัน   (08/2026 → 15 ก.ย. 2026)
    //             เขียนเป็น new Date(year, month, 15) ได้เพราะ month ตรงนี้ 1-indexed
    //             พอส่งเข้า Date ที่นับเดือนจาก 0 มันจึงหมายถึง "เดือนถัดไป วันที่ 15" พอดี
    const earliest = new Date(year, month - 1, 1 - tolerance);
    const latest = new Date(year, month, tolerance);
    latest.setHours(23, 59, 59, 999);

    if (parsed < earliest || parsed > latest) {
      throw new BadRequestException(
        `วันที่จดมิเตอร์ (${parsed.toLocaleDateString('th-TH')}) อยู่ห่างจากบิลเดือน ${billing_month}/${billing_year} เกิน ${tolerance} วัน กรุณาแก้วันที่จด หรือเปลี่ยนเดือนที่ออกบิลให้ตรงกันครับ`,
      );
    }

    return parsed;
  }

  /**
   * เพดานตายตัวสำหรับบ้านที่ยังไม่มีประวัติให้เทียบ — บ้านทั่วไปใช้กันเดือนละไม่กี่สิบหน่วย
   * เปิดให้ ScanBatchService อ่านได้ด้วย เกณฑ์ "หน่วยน้ำสมเหตุสมผลไหม" ต้องเป็นชุดเดียวกัน
   * ไม่งั้นหน้าอัปรูปจะเสนอบ้านที่พอกดยืนยันจริงแล้วโดนด่านนี้ตีกลับ
   */
  static readonly USAGE_HARD_CAP = 1000;
  /** กี่เท่าของค่ากลางจึงถือว่าผิดปกติ */
  static readonly USAGE_SPIKE_RATIO = 5;
  /** ต่ำกว่านี้ไม่ถือว่าผิดปกติแม้จะเกินอัตราส่วน (บ้านที่ปกติใช้ 2 หน่วย) */
  static readonly USAGE_SPIKE_FLOOR = 50;

  /**
   * กี่เท่าของค่ากลางจึง **ติดธงเตือน** — ไม่บล็อก ไม่ต้องกดยืนยัน
   *
   * ═══ ทำไมไม่เอา 2 เท่านี้มาเป็นเกณฑ์บล็อกไปเลย ═══
   *
   * เพราะหน่วยน้ำเกินสองเท่าเกิดขึ้นจริงเป็นปกติ — หน้าร้อนรดน้ำต้นไม้, ญาติมาพัก,
   * ล้างรถ/ล้างบ้านครั้งใหญ่ ถ้าบล็อกที่ระดับนี้เจ้าหน้าที่จะเจอหน้าต่างยืนยัน
   * แทบทุกใบแล้วกดผ่านเป็นนิสัย — ซึ่งทำให้ด่านที่ 5 เท่าพลอยไร้ความหมายไปด้วย
   * เพราะมือกดไปก่อนตาอ่านเสมอ
   *
   * ชั้นนี้จึงมีไว้ตอบคำถามคนละข้อ: "เดือนนี้บ้านไหนใช้น้ำขยับบ้าง" ซึ่งเอาไป
   * ไล่ดูย้อนหลัง (เช่นหาท่อรั่ว) ได้โดยไม่ต้องรบกวนคนที่กำลังเดินจดอยู่หน้างาน
   */
  static readonly USAGE_WARN_RATIO = 2;

  /** เกณฑ์ค่ากลางของระบบ — ใช้เมื่อหมู่บ้านไม่ได้ตั้งค่าเอง */
  static readonly DEFAULT_USAGE_THRESHOLDS: UsageThresholds = {
    warnRatio: BillsService.USAGE_WARN_RATIO,
    spikeRatio: BillsService.USAGE_SPIKE_RATIO,
    floor: BillsService.USAGE_SPIKE_FLOOR,
    hardCap: BillsService.USAGE_HARD_CAP,
  };

  /**
   * ย้อนดูบิลกี่ใบล่าสุดเพื่อหา "หน่วยที่บ้านหลังนี้ใช้ตามปกติ"
   *
   * 6 เดือนพอเห็นทั้งหน้าร้อนและหน้าฝน แต่ไม่ยาวจนพฤติกรรมเมื่อ 3 ปีก่อน
   * (ตอนยังไม่มีเครื่องซักผ้า / คนอยู่บ้านคนละจำนวน) มาถ่วงเกณฑ์ของวันนี้
   */
  static readonly USAGE_BASELINE_MONTHS = 6;

  /**
   * "หน่วยที่ใช้ตามปกติ" ของบ้านหลังหนึ่ง — null เมื่อยังไม่มีประวัติ
   *
   * ═══ ทำไมเป็น median ของ 6 เดือนล่าสุด ไม่ใช่ค่าเฉลี่ยของทุกใบ ═══
   *
   * ของเดิมใช้ค่าเฉลี่ยของบิลทุกใบตลอดกาล ซึ่งมีปัญหาสองชั้นที่ทับกัน:
   *
   *   1. ค่าเฉลี่ยถูกลากด้วยค่าโดด — บ้านที่ท่อแตกครั้งเดียว 400 หน่วย
   *      จะดันค่าเฉลี่ยขึ้น **ถาวร** ด่านอ่อนลงทุกเดือนหลังจากนั้น
   *   2. ยิ่งใช้งานนาน ยิ่งมีบิลเยอะ ค่าเฉลี่ยยิ่งขยับยาก ด่านที่ควรแม่นขึ้น
   *      ตามข้อมูลที่มากขึ้นกลับด้านลงเรื่อย ๆ
   *
   * median ทนค่าโดดโดยธรรมชาติ (ค่าเดียวที่พุ่งไม่ขยับกลางเลย) และการตัดที่
   * 6 เดือนทำให้เกณฑ์ตามพฤติกรรมปัจจุบันของบ้านหลังนั้นจริง ๆ
   *
   * แนวเดียวกับที่ learnedMeterLocations() ใช้ median กับพิกัด — ด้วยเหตุผลเดียวกัน
   *
   * static เพราะ ScanBatchService ต้องใช้สูตรเดียวกันเป๊ะ ไม่งั้นหน้าอัปรูป
   * จะเสนอบ้านที่พอกดยืนยันจริงแล้วโดนด่านนี้ตีกลับเป็น 409
   */
  static usageBaseline(history: number[]): number | null {
    const recent = history
      .filter((u) => u > 0)
      .slice(-BillsService.USAGE_BASELINE_MONTHS);
    if (recent.length === 0) return null;

    const sorted = [...recent].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * กันเลขมิเตอร์ที่ AI อ่านผิดจนออกบิลมหาศาล
   *
   * ไม่บล็อกตายตัว เพราะบางทีก็ใช้เยอะจริง (ท่อแตก/เปิดลืม) แต่ต้องให้คนยืนยันก่อน
   * ไม่ใช่ผ่านไปเงียบ ๆ แล้วไปโผล่เป็นบิลที่ลูกบ้านต้องจ่าย
   *
   * ═══ ทำไมต้องหารด้วย period_months ═══
   *
   * บิลที่คาบ 2 เดือน (เพราะเดือนก่อนไม่ได้ไปจด) มีหน่วยน้ำเป็นสองเท่าโดยธรรมชาติ
   * ถ้าเทียบตัวเลขดิบกับเกณฑ์รายเดือน จะเด้ง 409 ทั้งที่เลขถูกต้องทุกอย่าง
   * แล้วคนก็จะชินกับการกดยืนยันผ่าน — ซึ่งทำให้ด่านนี้ไร้ความหมายในวันที่เลขผิดจริง
   */
  private assertUsageLooksSane(
    usage_unit: number,
    previousBills: BillEntity[],
    confirmHighUsage?: boolean,
    period_months = 1,
    thresholds: UsageThresholds = BillsService.DEFAULT_USAGE_THRESHOLDS,
    confirmedBy?: number | null,
  ): PendingFlag[] {
    // เทียบ "หน่วยต่อเดือน" กับเกณฑ์ที่เป็นรายเดือนเหมือนกัน
    const months = Math.max(1, period_months);
    const perMonth = usage_unit / months;
    const spanNote =
      months > 1
        ? ` (บิลนี้คาบ ${months} เดือน = เดือนละ ${Math.round(perMonth).toLocaleString('th-TH')} หน่วย)`
        : '';

    const typical = BillsService.usageBaseline(
      previousBills.map((b) => Number(b.usage_unit)),
    );

    if (typical !== null) {
      // ต้องเกิน floor ด้วย ไม่งั้นบ้านที่ปกติใช้ 2 หน่วย พอใช้ 11 หน่วยก็เด้งแล้ว
      const overFloor = perMonth > thresholds.floor;

      if (
        !confirmHighUsage &&
        overFloor &&
        perMonth > typical * thresholds.spikeRatio
      ) {
        throw new ConflictException(
          billError(
            BILL_ERROR_CODES.HIGH_USAGE,
            `หน่วยน้ำที่คำนวณได้ (${usage_unit.toLocaleString('th-TH')} หน่วย)${spanNote} สูงกว่าที่บ้านหลังนี้ใช้ตามปกติมาก (ปกติเดือนละ ${Math.round(typical).toLocaleString('th-TH')} หน่วย) กรุณาตรวจสอบเลขมิเตอร์อีกครั้ง ถ้าถูกต้องแล้วให้กดยืนยันครับ`,
            409,
          ),
        );
      }

      const flags: PendingFlag[] = [];
      if (confirmHighUsage) {
        flags.push({
          flag_type: 'high_usage',
          detail: `${usage_unit} หน่วย / คาบ ${months} เดือน (ปกติเดือนละ ${Math.round(typical)} หน่วย) — กดยืนยันผ่าน`,
          confirmed_by: confirmedBy ?? null,
        });
      } else if (overFloor && perMonth > typical * thresholds.warnRatio) {
        // ชั้นเตือน: ไม่บล็อก ไม่ต้องกดอะไร แค่ทิ้งร่องรอยไว้ให้ไล่ดูย้อนหลังได้
        // ตั้งไว้เตี้ยกว่าชั้นบล็อกเพราะจุดประสงค์คนละอย่าง — ชั้นนี้ตอบคำถาม
        // "บ้านไหนใช้น้ำขยับผิดปกติบ้าง" ซึ่งถ้าเอาไปบล็อกจะเด้งจนคนกดผ่านเป็นนิสัย
        flags.push({
          flag_type: 'usage_warning',
          detail: `${usage_unit} หน่วย / คาบ ${months} เดือน = เดือนละ ${Math.round(perMonth)} หน่วย (ปกติ ${Math.round(typical)} หน่วย)`,
        });
      }
      return flags;
    }

    if (!confirmHighUsage && perMonth > thresholds.hardCap) {
      throw new ConflictException(
        billError(
          BILL_ERROR_CODES.HIGH_USAGE,
          `หน่วยน้ำที่คำนวณได้ (${usage_unit.toLocaleString('th-TH')} หน่วย)${spanNote} สูงผิดปกติ กรุณาตรวจสอบเลขมิเตอร์อีกครั้ง ถ้าถูกต้องแล้วให้กดยืนยันครับ`,
          409,
        ),
      );
    }

    return confirmHighUsage && perMonth > thresholds.hardCap
      ? [
          {
            flag_type: 'high_usage',
            detail: `${usage_unit} หน่วย (บ้านใหม่ ยังไม่มีประวัติ) — กดยืนยันผ่าน`,
            confirmed_by: confirmedBy ?? null,
          },
        ]
      : [];
  }

  /**
   * เกณฑ์หน่วยน้ำผิดปกติของหมู่บ้านหนึ่ง — ไม่ตั้งค่าไว้ก็ใช้ค่ากลางของระบบ
   *
   * ตั้งค่าได้รายหมู่บ้านเพราะพฤติกรรมใช้น้ำต่างกันจริง (หมู่บ้านที่ทำเกษตร
   * หลังบ้านกับหมู่บ้านจัดสรรไม่ควรใช้เกณฑ์เดียวกัน) แต่ค่าที่ไม่ได้ตั้งต้อง
   * ให้ผลเหมือนเดิมเป๊ะ ไม่งั้น migration จะเปลี่ยนพฤติกรรมของหมู่บ้านที่ยังไม่ได้แตะ
   */
  private thresholdsOf(village: VillageEntity | null): UsageThresholds {
    const positive = (value: unknown, fallback: number) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : fallback;
    };

    return {
      warnRatio: positive(
        village?.usage_warn_ratio,
        BillsService.USAGE_WARN_RATIO,
      ),
      spikeRatio: positive(
        village?.usage_spike_ratio,
        BillsService.USAGE_SPIKE_RATIO,
      ),
      floor: positive(
        village?.usage_spike_floor,
        BillsService.USAGE_SPIKE_FLOOR,
      ),
      hardCap: BillsService.USAGE_HARD_CAP,
    };
  }

  /**
   * ความมั่นใจต่ำสุดที่ยอมให้ออกบิลโดยไม่ต้องกดยืนยัน
   *
   * 0.85 มาจากชุดทดสอบของ vision service — เคสที่อ่านผิดจริงทั้ง 4/4 เคส
   * ได้ค่าต่ำกว่า 0.85 ทุกตัว (ดูคอมเมนต์ใน meter-vision-service/main.py)
   */
  static readonly MIN_READ_CONFIDENCE = 0.85;

  /**
   * กัน OCR อ่านผิดค่าโดยจำนวนหลักไม่เปลี่ยน (1250 → 1258)
   *
   * ═══ ทำไมด่านอื่นจับไม่ได้ ═══
   *
   * เคสนี้เคยเป็นช่องโหว่ที่ทะลุทุกด่าน:
   *   - ด่านจำนวนหลัก: 1250 กับ 1258 มี 4 หลักเท่ากัน ผ่านฉลุย
   *   - ด่านหน่วยพุ่ง: ต่างกันแค่ 8 หน่วย ห่างจากเกณฑ์ "เกินค่ากลาง 5 เท่า" มาก
   *
   * ตัวที่จับได้คือ confidence ซึ่ง vision service คืนมาเป็น **ค่าของหลักที่อ่อนที่สุด**
   * (ไม่ใช่ค่าเฉลี่ย — ค่าเฉลี่ยจะกลบหลักที่ไม่ชัดจนมองไม่เห็น) ค่านี้ถูกส่งมาถึง
   * NestJS อยู่แล้วตั้งแต่ต้น แต่ก่อนหน้านี้ถูกส่งต่อให้หน้าเว็บเฉย ๆ ไม่ได้เอามาเป็นด่าน
   *
   * เป็น 409 ให้กดยืนยัน ไม่ใช่บล็อกตาย เพราะรูปที่เบลอนิดหน่อยแต่คนตรวจดูแล้ว
   * อ่านออกชัดเจนก็มีจริง — คนที่ถือรูปอยู่ตรงหน้าตัดสินได้ดีกว่าโมเดล
   */
  private assertReadingConfident(params: {
    read_confidence?: number;
    current_unit: number;
    confirm_low_confidence?: boolean;
  }): number | null {
    const conf = Number(params.read_confidence);
    // ไม่ได้ส่งมา = กรอกเลขเอง ไม่ได้ผ่าน OCR จึงไม่มีอะไรให้ตรวจ
    if (!Number.isFinite(conf) || conf <= 0) return null;

    if (
      !params.confirm_low_confidence &&
      conf < BillsService.MIN_READ_CONFIDENCE
    ) {
      throw new ConflictException(
        billError(
          BILL_ERROR_CODES.LOW_CONFIDENCE,
          `ระบบอ่านเลขมิเตอร์ได้ไม่ชัดเจน (หลักที่ไม่ชัดที่สุดมั่นใจ ${Math.round(conf * 100)}% ต่ำกว่าเกณฑ์ ${Math.round(BillsService.MIN_READ_CONFIDENCE * 100)}%) เลขที่อ่านได้คือ ${params.current_unit.toLocaleString('th-TH')} — กรุณาเทียบกับรูปหน้าปัดทีละหลัก ถ้าตรงแล้วให้กดยืนยันครับ`,
          409,
        ),
      );
    }

    // ปัดให้พอดีกับคอลัมน์ decimal(4,3) กันค่าอย่าง 0.8734999 ไปโดน MySQL ปัดเอง
    return Math.round(conf * 1000) / 1000;
  }

  /** ย้อนดูการจดกี่ครั้งล่าสุดเพื่อหาจำนวนหลักอ้างอิง (ราวหนึ่งปี เผื่อเดือนที่กรอกมือปนอยู่) */
  private static readonly DIGIT_LOOKBACK_READINGS = 12;

  /**
   * จำนวนหลักที่บ้านหลังนี้อ่านได้ล่าสุด — null = ยังไม่เคยจดผ่าน OCR เลย
   *
   * ต้องตัดการจดของเดือนที่กำลังจะจดทับออกด้วย ไม่งั้นตอนกด "จดทับ" จะไปเทียบกับ
   * ค่าที่ OCR อ่านผิดของรอบก่อน แล้วบล็อกการแก้ให้ถูก ซึ่งกลับหัวกลับหางกับที่ต้องการ
   */
  private async latestMeterDigits(
    membersId: number,
    excludeReadingId?: number,
  ): Promise<number | null> {
    const readings = await this.meterReadingRepository.find({
      where: { members_id: membersId },
      order: { reading_date: 'DESC', id: 'DESC' },
      take: BillsService.DIGIT_LOOKBACK_READINGS,
    });

    for (const reading of readings) {
      if (reading.id === excludeReadingId) continue;
      const digits = Number(reading.meter_digits);
      if (Number.isInteger(digits) && digits > 0) return digits;
    }

    // ยังไม่เคยจดผ่าน OCR เลย — ถอยไปใช้จำนวนหลักที่บันทึกไว้ในทะเบียนมิเตอร์
    //
    // ปิดช่องที่เคยเปิดอยู่: ด่านนี้เคยเริ่มทำงานตั้งแต่การจดด้วย OCR **ครั้งที่สอง**
    // เป็นต้นไป บิลใบแรกของบ้านจึงไม่มีอะไรเทียบเลย ทั้งที่เป็นใบที่เสี่ยงที่สุด
    // (ยังไม่มีประวัติการใช้น้ำให้ด่านหน่วยพุ่งจับด้วย ใช้เพดาน 1,000 หน่วยที่หลวมมาก)
    const meter = await this.meterRepository.findOne({
      where: { members_id: membersId, removed_at: IsNull() },
      order: { installed_at: 'DESC', id: 'DESC' },
    });
    const registered = Number(meter?.digits);
    return Number.isInteger(registered) && registered > 0 ? registered : null;
  }

  /**
   * กัน OCR อ่านหลักหาย/หลักเกิน — ความผิดพลาดที่ทำให้ยอดคลาด 10 เท่าในครั้งเดียว
   *
   * ด่านหน่วยน้ำพุ่ง (assertUsageLooksSane) จับเคสนี้ได้ไม่ครบ:
   *   - บ้านใหม่ที่ยังไม่มีประวัติใช้เพดาน 1,000 หน่วย ซึ่งหลวมพอให้เลขเกินมาหนึ่งหลักลอดไปได้
   *   - บ้านที่ปกติใช้เยอะอยู่แล้ว เพดาน "เฉลี่ย × 5" ก็สูงตามไปด้วย
   *
   * ด่านนี้ไม่พึ่งประวัติการใช้น้ำเลย เทียบแค่ว่าหน้าปัดมีกี่หลัก ซึ่งเป็นค่าคงที่
   * ของมิเตอร์ตัวนั้นตลอดอายุการใช้งาน จึงจับได้ตั้งแต่บิลใบที่สองเป็นต้นไป
   *
   * เปิดทางออกด้วย confirm_digit_change แนวเดียวกับด่านอื่น เพราะเปลี่ยนมิเตอร์
   * เป็นรุ่นที่หลักไม่เท่าเดิมก็เกิดขึ้นได้จริง — บล็อกตายจะทำให้บ้านนั้นออกบิลไม่ได้อีกเลย
   */
  private assertDigitsLookSane(params: {
    current_unit: number;
    meter_digits?: number;
    known_digits: number | null;
    confirm_digit_change?: boolean;
  }): number | null {
    const digits = Number(params.meter_digits);
    // ไม่ได้ส่งมา = กรอกเลขเอง ไม่ได้ผ่าน OCR จึงไม่มีอะไรให้ตรวจ
    if (!Number.isInteger(digits) || digits <= 0) return null;

    if (
      params.confirm_digit_change ||
      params.known_digits === null ||
      digits === params.known_digits
    ) {
      return digits;
    }

    const direction = digits < params.known_digits ? 'หาย' : 'เกิน';
    throw new ConflictException(
      `หน้าปัดมิเตอร์ของบ้านหลังนี้เคยอ่านได้ ${params.known_digits} หลัก แต่รอบนี้อ่านได้ ${digits} หลัก (เลขที่อ่านได้คือ ${params.current_unit.toLocaleString('th-TH')}) — มิเตอร์ตัวเดิมมีจำนวนหลักคงที่เสมอ กรณีแบบนี้ส่วนใหญ่เกิดจากระบบอ่านหลัก${direction} กรุณาเทียบกับรูปหน้าปัดอีกครั้งครับ ถ้าเลขถูกต้องแล้ว (เช่นเพิ่งเปลี่ยนมิเตอร์เป็นรุ่นที่จำนวนหลักไม่เท่าเดิม) ให้กดยืนยันครับ`,
    );
  }

  /**
   * หน่วยน้ำที่ใช้ไป — รองรับกรณีมิเตอร์เริ่มนับใหม่
   *
   * ปกติเลขมิเตอร์ต้องเดินหน้าเสมอ เลขที่ต่ำกว่าเดือนก่อนจึงแปลว่าอ่านผิดและต้องบล็อก
   * แต่มีสองกรณีที่ต่ำกว่าได้จริงและ **เกิดแน่นอนตามอายุการใช้งาน**:
   *   1. เปลี่ยนมิเตอร์ตัวใหม่ (ตัวเก่าเสีย) — ตัวใหม่เริ่มที่ 0
   *   2. มิเตอร์นับครบรอบ เช่น 99999 แล้ววนกลับเป็น 00000
   *
   * ของเดิมบล็อกตายโดยไม่มีทางออกเลย บ้านที่เจอเคสนี้จะออกบิลไม่ได้อีกตลอดไป
   * จนกว่าจะมีคนเข้าไปแก้ฐานข้อมูลด้วยมือ — ต่างจากด่านหน่วยน้ำพุ่งที่ยังมี
   * confirm_high_usage ให้กดผ่านได้ จึงเติมทางออกให้เป็นแนวเดียวกัน
   */
  private resolveUsage(params: {
    current_unit: number;
    previous_unit: number;
    confirm_meter_reset?: boolean;
    old_meter_final_unit?: number;
  }): { previous_unit: number; usage_unit: number; meter_reset: boolean } {
    if (params.current_unit >= params.previous_unit) {
      return {
        previous_unit: params.previous_unit,
        usage_unit: params.current_unit - params.previous_unit,
        meter_reset: false,
      };
    }

    if (!params.confirm_meter_reset) {
      throw new BadRequestException(
        `เลขมิเตอร์ที่จด (${params.current_unit.toLocaleString('th-TH')}) น้อยกว่าเลขตั้งต้นของเดือนก่อน (${params.previous_unit.toLocaleString('th-TH')}) กรุณาตรวจสอบตัวเลขอีกครั้งครับ — ถ้าเพิ่งเปลี่ยนมิเตอร์ตัวใหม่ หรือมิเตอร์นับครบรอบแล้ววนกลับเป็น 0 ให้กดยืนยันการเปลี่ยนมิเตอร์`,
      );
    }

    // น้ำที่ใช้บนมิเตอร์ตัวเก่าตั้งแต่บิลเดือนก่อนจนถึงวันถอด
    // ไม่กรอกมาก็คิดแค่มิเตอร์ตัวใหม่ — คิดขาดดีกว่าคิดเกิน เพราะลูกบ้านเป็นฝ่ายจ่าย
    let residual = 0;
    if (params.old_meter_final_unit !== undefined) {
      if (params.old_meter_final_unit < params.previous_unit) {
        throw new BadRequestException(
          `เลขปิดของมิเตอร์ตัวเก่า (${params.old_meter_final_unit.toLocaleString('th-TH')}) น้อยกว่าเลขตั้งต้นของเดือนก่อน (${params.previous_unit.toLocaleString('th-TH')}) กรุณาตรวจสอบอีกครั้งครับ`,
        );
      }
      residual = params.old_meter_final_unit - params.previous_unit;
    }

    return {
      previous_unit: 0,
      usage_unit: params.current_unit + residual,
      meter_reset: true,
    };
  }

  /** ให้เวลาชำระกี่วัน เมื่อหมู่บ้านไม่ได้ตั้งค่าไว้ — รอบที่พบบ่อยที่สุด */
  static readonly DEFAULT_PAYMENT_DUE_DAYS = 15;

  /**
   * หมู่บ้านของบ้านหลังนี้ — null เมื่อยังไม่ได้ผูกหมู่บ้าน หรือหาไม่เจอ
   *
   * แยกออกมาเพราะตอนนี้มีสามเรื่องที่ต้องอ่านค่าจากหมู่บ้านเดียวกันในการออกบิล
   * หนึ่งครั้ง (รอบชำระ, เกณฑ์หน่วยพุ่ง, รัศมี GPS) — ปล่อยให้ต่างคนต่างโหลด
   * เท่ากับยิงคิวรีซ้ำสามรอบต่อการออกบิลหนึ่งใบ
   */
  private async villageOfMember(
    membersId: number,
  ): Promise<VillageEntity | null> {
    const member = await this.memberRepository.findOne({
      where: { id: membersId },
    });
    if (!member?.villages_id) return null;

    return await this.villageRepository.findOne({
      where: { id: member.villages_id },
    });
  }

  /**
   * วันครบกำหนดชำระของบิลใบนี้ = วันจดมิเตอร์ + รอบชำระของหมู่บ้าน
   *
   * นับจากวันจด ไม่ใช่วันที่ 1 ของเดือนบิล เพราะลูกบ้านเริ่มรู้ยอดตอนที่พนักงาน
   * ไปจดถึงหน้าบ้าน — จดวันที่ 28 แล้วให้ครบกำหนดวันที่ 15 ของเดือนเดียวกัน
   * เท่ากับเลยกำหนดตั้งแต่วินาทีที่ออกบิล
   */
  private resolveDueDate(
    village: VillageEntity | null,
    reading_date: Date,
  ): Date {
    const days =
      village?.payment_due_days && village.payment_due_days > 0
        ? village.payment_due_days
        : BillsService.DEFAULT_PAYMENT_DUE_DAYS;

    // คัดลอกก่อนบวก — reading_date ถูกเอาไปเขียนลง meter_readings ด้วย
    // แก้ตัวเดิมจะทำให้วันที่จดเลื่อนตามไปโดยไม่มีใครตั้งใจ
    const due = new Date(reading_date);
    due.setDate(due.getDate() + days);
    return due;
  }

  /**
   * บิลใบนี้คาบกี่เดือน — 1 คือปกติ, มากกว่านั้นแปลว่ามีเดือนที่ไม่ได้ไปจดคั่นอยู่
   *
   * นับจากบิลใบก่อนหน้าเท่านั้น ถ้ายังไม่เคยมีบิลเลย (ใบแรกของบ้าน) ถือเป็น 1
   * เพราะช่วงก่อนหน้านั้นคือ "ก่อนเข้าระบบ" ซึ่งคิดเป็นคาบบิลไม่ได้
   */
  private periodMonthsFrom(
    previousBill: BillEntity | null,
    year: number,
    month: number,
  ): number {
    if (!previousBill) return 1;

    const gap =
      this.monthIndex(year, month) -
      this.monthIndex(previousBill.billing_year, previousBill.billing_month);

    // คอลัมน์เป็น tinyint unsigned — บ้านที่หายไปนานกว่า 20 ปีคือข้อมูลผิด ไม่ใช่คาบบิล
    if (!Number.isInteger(gap) || gap < 1) return 1;
    return Math.min(gap, 255);
  }

  /** ห่างจากวันถ่ายเกินนี้ = รูปเก่า ไม่ใช่แค่นาฬิกากล้องเพี้ยน */
  private static readonly STALE_PHOTO_DAYS = 30;

  /**
   * ถ่ายห่างกันไม่เกินนี้ **และ** ยืนอยู่ที่เดิม = กดชัตเตอร์รัว ไม่ใช่คนละมิเตอร์
   *
   * 3 วินาทีมาจากเวลาที่ใช้เดินจากมิเตอร์หนึ่งไปอีกหลัง — ต่อให้บ้านติดกัน
   * ที่ pitch แคบสุด (ทาวน์โฮม 4 ม.) ก็ยังต้องเดินและเล็งกล้องใหม่
   */
  static readonly BURST_WINDOW_MS = 3000;

  /**
   * ขยับไม่ถึงระยะนี้ถือว่า "ยืนที่เดิม"
   *
   * 5 ม. เล็กกว่าระยะห่างระหว่างมิเตอร์ที่แคบที่สุด (ทาวน์โฮม 4-8 ม.) เล็กน้อย
   * ตั้งกว้างกว่านี้จะเริ่มปฏิเสธคนที่ถ่ายสองบ้านติดกันจริง ๆ
   */
  static readonly BURST_MOVE_M = 5;

  /**
   * นาฬิกาเครื่องเดินเร็วกว่า server ได้กี่นาทีก่อนถือว่าผิด
   *
   * มือถือกับ server คลาดกันไม่กี่วินาทีเป็นปกติ (คนละ NTP หรือไม่ได้ซิงก์มานาน)
   * เผื่อ 5 นาทีจึงกว้างพอสำหรับความคลาดจริง แต่แคบพอจะจับ "ตั้งเวลาเครื่อง
   * ล่วงหน้าเพื่อให้รูปเก่าดูเหมือนถ่ายวันนี้" ซึ่งคลาดเป็นชั่วโมงหรือเป็นวันเสมอ
   */
  static readonly FUTURE_CLOCK_SKEW_MIN = 5;

  /** ถ่ายไว้เกินกี่ชั่วโมงก่อนส่งเข้าระบบจึงติดธงเตือน (ไม่บล็อก) */
  static readonly PHOTO_AGE_WARN_HOURS = 24;

  // ==========================================
  // กลุ่มมิเตอร์ที่ติดกันจน GPS แยกไม่ออก
  // ==========================================

  /**
   * บ้านทุกหลังในกลุ่มมิเตอร์เดียวกัน (รวมตัวเอง) — ว่างเมื่อบ้านหลังนี้ไม่ได้อยู่ในกลุ่มไหน
   *
   * ═══ ทำไมต้องมี ═══
   *
   * มิเตอร์ทาวน์โฮมเรียงติดกันบนกำแพงเดียวกัน ห่างกันราว 30 ซม. ส่วน GPS มือถือ
   * คลาดเคลื่อน 3-5 ม. ในที่โล่งและ 10-30 ม. ใต้ชายคา — ความคลาดเคลื่อนกว้างกว่า
   * ระยะจริงเป็นสิบเท่า ทุกด่านที่ตัดสินจาก "ระยะทาง" จึงให้คำตอบมั่วสำหรับกลุ่มนี้:
   * เดินไปอีกหนึ่งตัวแล้วถ่าย ระบบเห็นว่า "ยืนอยู่ที่เดิม" ทุกครั้ง
   *
   * บ้านในกลุ่มเดียวกันจึงต้อง **ข้ามด่านที่ใช้ระยะทาง** แล้วไปตรวจด้วยตัวเลขแทน
   * (current_unit เทียบ previous_unit — ดู assertClusterReadingFits) ส่วนตำแหน่ง
   * ซ้าย/ขวาเป็นหน้าที่ของ sequence_index ซึ่งเป็นค่าตายตัวที่ไม่แกว่งตามสัญญาณ
   */
  private async clusterMemberIds(membersId: number): Promise<Set<number>> {
    const member = await this.memberRepository.findOneBy({ id: membersId });
    const cluster = member?.cluster_group_id ?? null;
    if (!cluster) return new Set<number>();

    const mates = await this.memberRepository.find({
      where: { cluster_group_id: cluster },
    });
    return new Set(mates.map((m) => m.id));
  }

  /** ป้ายบอกตำแหน่งที่คนอ่านแล้วเห็นภาพ — ซ้ายสุด / ตรงกลาง / ขวาสุด */
  static positionLabel(
    sequence_index: number | null | undefined,
    total: number,
  ): string {
    if (!sequence_index) return 'ยังไม่ได้ระบุตำแหน่ง';
    if (sequence_index === 1) return 'ซ้ายสุด';
    if (sequence_index === total) return 'ขวาสุด';
    return total === 3 ? 'ตรงกลาง' : `ตัวที่ ${sequence_index} จากซ้าย`;
  }

  /**
   * เลขที่จดเข้ากับบ้านหลังนี้จริงไหม เมื่อมิเตอร์อยู่ในกลุ่มที่ติดกัน
   *
   * ด่านนี้มาแทนสิ่งที่ GPS เคยถูกคาดหวังให้ทำ (แต่ทำไม่ได้): บอกว่าจดสลับตัวซ้าย/ตัวขวา
   * เกณฑ์เป็นตัวเลขล้วน ๆ — มิเตอร์เดินหน้าอย่างเดียว เลขที่จดจึงต้องไม่ต่ำกว่า
   * เลขตั้งต้นของบ้านหลังนั้น ถ้าต่ำกว่าของหลังที่เลือกแต่ไปเข้าของเพื่อนบ้านในกลุ่มพอดี
   * นั่นคือหลักฐานตรง ๆ ว่าหยิบผิดตัว ไม่ใช่ "มิเตอร์เดินถอยหลัง"
   *
   * เงียบไว้เมื่อ:
   *   - บ้านหลังนี้ไม่ได้อยู่ในกลุ่ม (บ้านเดี่ยว — ด่าน METER_ROLLBACK เดิมทำงานตามปกติ)
   *   - เลขไม่ได้ต่ำกว่าเลขตั้งต้น (ไม่มีอะไรผิดให้อธิบาย)
   *   - มีหลายหลังในกลุ่มที่เข้าได้ (ชี้ไม่ขาด บอกไปก็เดาให้เขาเปล่า ๆ)
   */
  private async assertClusterReadingFits(params: {
    membersId: number;
    current_unit: number;
    previous_unit: number;
    billing_month: string;
    billing_year: string;
  }): Promise<void> {
    if (params.current_unit >= params.previous_unit) return;

    const member = await this.memberRepository.findOneBy({
      id: params.membersId,
    });
    if (!member?.cluster_group_id) return;

    const mates = await this.memberRepository.find({
      where: { cluster_group_id: member.cluster_group_id },
      order: { sequence_index: 'ASC', id: 'ASC' },
    });

    const fits: { house_no: string; label: string; previous_unit: number }[] =
      [];
    for (const mate of mates) {
      if (mate.id === member.id) continue;

      const baseline = await this.getPreviousUnit(
        mate.id,
        params.billing_month,
        params.billing_year,
      );
      // เข้าได้ = เลขนี้ไม่ต่ำกว่าเลขตั้งต้นของหลังนั้น (มิเตอร์เดินหน้าอย่างเดียว)
      if (params.current_unit >= baseline.previous_unit) {
        fits.push({
          house_no: mate.house_no,
          label: BillsService.positionLabel(mate.sequence_index, mates.length),
          previous_unit: baseline.previous_unit,
        });
      }
    }

    if (fits.length !== 1) return;

    const [fit] = fits;
    const here = BillsService.positionLabel(
      member.sequence_index,
      mates.length,
    );
    throw new ConflictException(
      billError(
        BILL_ERROR_CODES.CLUSTER_SEQUENCE_MISMATCH,
        `เลขที่จด (${params.current_unit.toLocaleString('th-TH')}) ต่ำกว่าเลขตั้งต้นของบ้าน ${member.house_no} (ตำแหน่ง: ${here}) ซึ่งอยู่ที่ ${params.previous_unit.toLocaleString('th-TH')} แต่เข้ากับบ้าน ${fit.house_no} (ตำแหน่ง: ${fit.label}, เลขตั้งต้น ${fit.previous_unit.toLocaleString('th-TH')}) ในกลุ่มมิเตอร์เดียวกันพอดี — น่าจะจดสลับตัวกัน กรุณาเลือกบ้านให้ตรงกับตำแหน่งของมิเตอร์ที่ถ่ายมาครับ`,
        409,
      ),
    );
  }

  /**
   * กันรูปเก่า/รูปใช้ซ้ำ — ตรวจสองชั้นจากข้อมูลที่มีอยู่แล้วในตาราง
   *
   * ═══ ชั้นที่ 1: captured_at ซ้ำเป๊ะ = ไฟล์เดียวกันแน่นอน ═══
   *
   * EXIF บันทึกเวลาถึงระดับวินาที การถ่ายสองครั้งได้วินาทีเดียวกันเป๊ะแทบเป็นไปไม่ได้
   * ถ้าตรงกับแถวที่มีอยู่แล้ว แปลว่าเป็นไฟล์เดิมถูกอัปซ้ำ — **บล็อกตาย ไม่มีปุ่มยืนยัน**
   * เพราะไม่มีสถานการณ์ที่ถูกต้องเลยที่จะเกิดเหตุการณ์นี้
   *
   * ═══ ชั้นที่ 2: พิกัดตรงกันทุกทศนิยม = น่าสงสัยแต่ไม่ฟันธง ═══
   *
   * GPS จริงไม่เคยให้ค่าเดิมเป๊ะทุกทศนิยมสองครั้ง (decimal(10,8) = ละเอียดระดับ 1 มม.)
   * ถ้าเจอ แปลว่าค่านั้นถูกคัดลอกมา ไม่ได้วัดใหม่ — แต่เปิดปุ่มยืนยันไว้
   * เผื่อหน้าเว็บ cache พิกัดไว้แล้วส่งค่าเดิมมาโดยที่คนถ่ายรูปใหม่จริง
   *
   * ตรวจข้ามทุกบ้าน ไม่ใช่แค่บ้านหลังนี้ — รูปที่ถูกยกไปใช้เป็นหลักฐานของบ้านอื่น
   * คือเคสที่อันตรายกว่ารูปซ้ำของบ้านตัวเอง
   */
  private async assertPhotoNotReused(params: {
    membersId: number;
    latitude: number | null;
    longitude: number | null;
    captured_at: Date | null;
    excludeReadingId?: number;
    confirm_duplicate_location?: boolean;
  }): Promise<void> {
    const { latitude, longitude, captured_at } = params;

    if (captured_at) {
      const sameShot = await this.meterReadingRepository.findOne({
        where: { captured_at },
      });
      if (sameShot && sameShot.id !== params.excludeReadingId) {
        throw new ConflictException(
          billError(
            BILL_ERROR_CODES.PHOTO_REUSED,
            `รูปนี้ถ่ายเมื่อ ${captured_at.toLocaleString('th-TH')} ซึ่งตรงกับการจดมิเตอร์ที่บันทึกไว้แล้ว (รหัสการจด ${sameShot.id}) — เป็นไฟล์รูปเดิมที่เคยใช้ไปแล้ว กรุณาถ่ายรูปหน้าปัดใหม่ครับ`,
            409,
          ),
        );
      }
    }

    // ═══ ชั้นที่ 1.5: ถ่ายรัวหลายใบที่จุดเดียวกัน — บล็อกตาย ═══
    //
    // ชั้นที่ 1 จับได้เฉพาะไฟล์เดิมเป๊ะ ๆ แต่การกดชัตเตอร์รัว 5 ครั้งได้ 5 ไฟล์ที่
    // captured_at ต่างกัน 0.3-0.8 วินาที ซึ่งลอดชั้นที่ 1 ไปทั้งหมด
    //
    // เกณฑ์ต้องใช้ทั้งเวลา **และ** ระยะ ไม่ใช่เวลาอย่างเดียว — สองบ้านที่มิเตอร์
    // ติดกำแพงเดียวกัน (ทาวน์โฮม/ห้องเช่า) ถ่ายห่างกัน 2-3 วินาทีเป็นเรื่องปกติจริง
    // การดูเวลาอย่างเดียวจะปฏิเสธคนที่ทำงานเร็ว ส่วนการดูระยะอย่างเดียวก็ปฏิเสธ
    // การกลับไปถ่ายซ้ำที่มิเตอร์เดิมในวันหลัง
    if (captured_at) {
      const from = new Date(
        captured_at.getTime() - BillsService.BURST_WINDOW_MS,
      );
      const to = new Date(captured_at.getTime() + BillsService.BURST_WINDOW_MS);

      const nearby = await this.meterReadingRepository.find({
        where: { captured_at: Between(from, to) },
      });

      // มิเตอร์ที่ติดกันบนกำแพงเดียวกัน: เดินไปอีกตัวแล้วถ่ายจริง ๆ ก็ยังขยับ 30 ซม.
      // ซึ่งต่ำกว่า BURST_MOVE_M (5 ม.) เสมอ ด่านนี้จึงฟ้อง "ยืนที่เดิมกดชัตเตอร์รัว"
      // ทุกครั้งที่ทำถูกต้อง — ต้องข้ามให้ทั้งกลุ่ม แล้วปล่อยให้ตัวเลขเป็นตัวตัดสินแทน
      const clusterMates = await this.clusterMemberIds(params.membersId);

      for (const shot of nearby) {
        if (shot.id === params.excludeReadingId) continue;
        if (!shot.captured_at) continue;
        if (
          shot.members_id !== params.membersId &&
          clusterMates.has(shot.members_id)
        ) {
          continue;
        }

        // ต้องเช็คด้วย isFinite ไม่ใช่ `=== null` — คอลัมน์ decimal ที่ไม่ได้ select
        // มาจะเป็น undefined ซึ่งลอดการเทียบกับ null ไปได้ แล้ว Number(undefined)
        // เป็น NaN ทำให้ `NaN > 5` เป็น false = ไม่ continue = ฟ้องว่าถ่ายรัวทั้งที่
        // ไม่มีพิกัดให้เทียบเลยสักค่า (ด่านที่ฟ้องผิดอันตรายกว่าด่านที่ไม่มี)
        const here = { lat: Number(latitude), lng: Number(longitude) };
        const there = {
          lat: Number(shot.latitude),
          lng: Number(shot.longitude),
        };
        if (
          !Number.isFinite(here.lat) ||
          !Number.isFinite(here.lng) ||
          !Number.isFinite(there.lat) ||
          !Number.isFinite(there.lng)
        ) {
          continue;
        }

        const moved = PhotoMetadataService.distanceMeters(
          { latitude: here.lat, longitude: here.lng },
          { latitude: there.lat, longitude: there.lng },
        );
        if (moved > BillsService.BURST_MOVE_M) continue;

        const gapSeconds =
          Math.abs(
            captured_at.getTime() - new Date(shot.captured_at).getTime(),
          ) / 1000;
        throw new ConflictException(
          billError(
            BILL_ERROR_CODES.BURST_PHOTO,
            `รูปนี้ถ่ายห่างจากการจดมิเตอร์ที่บันทึกไว้แล้ว (รหัสการจด ${shot.id}) เพียง ${gapSeconds.toFixed(1)} วินาที และอยู่ห่างกันแค่ ${Math.round(moved)} เมตร — เท่ากับยืนอยู่ที่เดิมแล้วกดชัตเตอร์รัว ไม่ใช่การเดินไปถ่ายมิเตอร์อีกหลัง กรุณาเดินไปถ่ายที่หน้ามิเตอร์ของบ้านนั้นจริง ๆ ครับ`,
            409,
          ),
        );
      }
    }

    if (
      latitude === null ||
      longitude === null ||
      params.confirm_duplicate_location
    ) {
      return;
    }

    // GPS มือถือให้ค่าเดิมเป๊ะสองครั้งได้จริง เมื่อมิเตอร์สองตัวห่างกัน 30 ซม.
    // (ต่ำกว่าความละเอียดที่เครื่องแยกออกหลายเท่า) — ในกลุ่มเดียวกันจึงไม่ใช่สัญญาณ
    // ของการคัดลอกพิกัดอีกต่อไป ต้องมองข้ามเฉพาะคู่ที่อยู่กลุ่มเดียวกันเท่านั้น
    // ส่วนพิกัดที่ไปซ้ำกับบ้านนอกกลุ่มยังเป็นเรื่องผิดปกติเหมือนเดิม
    const mates = [...(await this.clusterMemberIds(params.membersId))].filter(
      (id) => id !== params.membersId,
    );
    const samePlace = await this.meterReadingRepository.findOne({
      where: mates.length
        ? { latitude, longitude, members_id: Not(In(mates)) }
        : { latitude, longitude },
    });
    if (samePlace && samePlace.id !== params.excludeReadingId) {
      const owner =
        samePlace.members_id === params.membersId
          ? 'บ้านหลังเดียวกัน'
          : `บ้านอีกหลัง (รหัส ${samePlace.members_id})`;
      throw new ConflictException(
        `พิกัดที่ส่งมาตรงกับการจดมิเตอร์ของ${owner}แบบเป๊ะทุกทศนิยม ซึ่ง GPS จริงไม่เคยให้ค่าเดิมซ้ำสองครั้ง — มักแปลว่าพิกัดถูกคัดลอกมา ไม่ได้วัดใหม่ตอนยืนหน้ามิเตอร์ กรุณากดวัดพิกัดใหม่ ถ้ายืนยันว่าถ่ายใหม่จริงให้กดยืนยันครับ`,
      );
    }
  }

  /**
   * รูปที่ถ่ายไว้นานแล้วเอามาออกบิลรอบนี้
   *
   * ต่างจากคำเตือน "นาฬิกากล้องตั้งผิด" ของ ScanBatchService ตรงที่**ระดับความห่าง**:
   * นาฬิกาที่ตั้งผิดมักคลาดเป็นชั่วโมงหรือ timezone (ไม่เกินวัน) ส่วนที่คลาดเป็นเดือน
   * คือรูปเก่าจริง ๆ ซึ่งหมายถึงเลขบนหน้าปัดนั้นไม่ใช่เลขของวันนี้
   *
   * 409 ให้ยืนยัน ไม่บล็อกตาย เพราะจดค้างไว้แล้วมาออกบิลทีหลังก็เกิดขึ้นได้จริง
   */
  private assertPhotoNotStale(params: {
    captured_at: Date | null;
    reading_date: Date;
    confirm_stale_photo?: boolean;
  }): void {
    if (!params.captured_at || params.confirm_stale_photo) return;

    const gapDays = Math.abs(
      (params.reading_date.getTime() - params.captured_at.getTime()) /
        86_400_000,
    );
    if (gapDays > BillsService.STALE_PHOTO_DAYS) {
      throw new ConflictException(
        `รูปนี้ถ่ายเมื่อ ${params.captured_at.toLocaleDateString('th-TH')} ซึ่งห่างจากวันที่จดมิเตอร์ (${params.reading_date.toLocaleDateString('th-TH')}) ถึง ${Math.round(gapDays).toLocaleString('th-TH')} วัน — เลขบนหน้าปัดในรูปอาจไม่ใช่เลขของรอบนี้ กรุณาตรวจสอบว่าใช้รูปถูกใบ ถ้าถูกแล้วให้กดยืนยันครับ`,
      );
    }
  }

  /**
   * เวลาถ่ายที่เป็นอนาคต — **บล็อกตาย** / ถ่ายค้างไว้เกินหนึ่งวัน — ติดธงเตือน
   *
   * ═══ ทำไมอนาคตบล็อกตาย แต่อดีตแค่เตือน ═══
   *
   * เวลาในอนาคตไม่มีสถานการณ์ที่ถูกต้องเลย — ภาพยังไม่เกิดขึ้นแต่มีไฟล์แล้ว
   * แปลว่านาฬิกาเครื่องผิด (ซึ่งต้องแก้ก่อน ไม่งั้น captured_at ของทุกใบที่ถ่าย
   * วันนี้จะเชื่อไม่ได้ทั้งหมด) หรือถูกตั้งล่วงหน้าเพื่อให้รูปเก่าดูใหม่
   *
   * ส่วนอดีตเกิดขึ้นจริงตลอด — ถ่ายไว้ตอนไม่มีสัญญาณแล้วค่อยซิงก์ตอนกลับถึงที่ทำการ
   * เป็นพฤติกรรมปกติของ offline mode ด้วยซ้ำ จึงติดธงไว้เฉย ๆ ให้ไล่ดูย้อนหลังได้
   * (ส่วนที่เก่าเกิน 30 วันมีด่าน confirm_stale_photo คุมอีกชั้นอยู่แล้ว)
   */
  private assertCapturedAtSane(captured_at: Date | null): PendingFlag[] {
    if (!captured_at) return [];

    const now = Date.now();
    const skewMs = BillsService.FUTURE_CLOCK_SKEW_MIN * 60_000;

    if (captured_at.getTime() > now + skewMs) {
      throw new BadRequestException(
        billError(
          BILL_ERROR_CODES.FUTURE_TIMESTAMP,
          `เวลาที่ถ่ายรูป (${captured_at.toLocaleString('th-TH')}) เป็นเวลาในอนาคต — แปลว่านาฬิกาของเครื่องที่ถ่ายตั้งไม่ตรง กรุณาตั้งวันเวลาของเครื่องให้ถูกต้องแล้วถ่ายใหม่ครับ (ถ้าไม่แก้ เวลาของรูปทุกใบที่ถ่ายด้วยเครื่องนี้จะเชื่อถือไม่ได้)`,
          400,
        ),
      );
    }

    const ageHours = (now - captured_at.getTime()) / 3_600_000;
    if (ageHours > BillsService.PHOTO_AGE_WARN_HOURS) {
      return [
        {
          flag_type: 'stale_photo',
          detail: `ถ่ายไว้ ${Math.round(ageHours)} ชั่วโมงก่อนส่งเข้าระบบ (${captured_at.toLocaleString('th-TH')})`,
        },
      ];
    }

    return [];
  }

  /**
   * ตรวจทุกเงื่อนไขและคำนวณยอด — **ไม่เขียนอะไรลงฐานข้อมูลเลย**
   *
   * แยกออกมาเพื่อให้ createFromScan() ตรวจให้จบก่อนแล้วค่อยเขียน
   * ของเดิมสร้าง meter_readings ไปก่อนแล้วค่อยตรวจตอนสร้างบิล พอตรวจไม่ผ่าน
   * แถวที่จดไปแล้วก็ค้างเป็นขยะ (เคยเจอบ้านเดียวจด 4 ครั้ง ได้บิล 2 ใบ)
   */
  private async prepareBill(params: {
    membersId: number;
    water_rates_id: number;
    current_unit: number;
    billing_month: string;
    billing_year: string;
    reading_date?: string;
    replace?: boolean;
    confirm_high_usage?: boolean;
    confirm_meter_reset?: boolean;
    confirm_digit_change?: boolean;
    old_meter_final_unit?: number;
    meter_digits?: number;
    read_confidence?: number;
    confirm_low_confidence?: boolean;
    excludeReadingId?: number;
    /** เลขมาจาก OCR หรือคนกรอกเอง — 'manual*' บังคับต้องมีรูปหน้าปัด */
    entry_method?: string;
    /** มีรูปแนบมาด้วยไหม (ยังไม่เขียนไฟล์ตอนนี้ แค่รู้ว่ามี) */
    has_photo?: boolean;
    /** admin.id ของคนที่กดยืนยันข้ามด่าน — ติดไว้กับธงเพื่อให้ไล่ดูได้ว่าใครกด */
    confirmed_by?: number | null;
    /** บิลปิดยอดตอนย้ายออก — ข้ามการทบยอดค้าง เพราะทบเองอยู่แล้วในเส้นทางนั้น */
    skip_arrears?: boolean;
  }) {
    // ตรวจเดือน/ปีก่อนทุกอย่าง — คิวรีหาบิลซ้ำและการเทียบลำดับเดือนข้างล่างพึ่งค่านี้ทั้งหมด
    // ตั้งแต่บรรทัดนี้ลงไปใช้ billing_month/billing_year ของ period เท่านั้น (เติมศูนย์แล้ว)
    // ไม่ใช้ params.* ดิบ ๆ อีก ไม่งั้นแถวที่บันทึกจะยังเป็น '8' ปนกับ '08' ในตารางเดียวกัน
    const period = this.normalizeBillingPeriod(
      params.billing_month,
      params.billing_year,
    );
    const { billing_month, billing_year } = period;

    const reading_date = this.parseReadingDate(
      params.reading_date,
      billing_month,
      billing_year,
    );

    const rate = await this.waterRateRepository.findOne({
      where: { id: params.water_rates_id },
    });
    if (!rate) {
      throw new NotFoundException('ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ');
    }

    // 1 บ้าน ต้องมีบิลได้เดือนละใบเดียว ไม่งั้นลูกบ้านโดนเก็บซ้ำ
    const existing = await this.findByMemberAndMonth(
      params.membersId,
      billing_month,
      billing_year,
    );

    if (existing) {
      // จ่ายเงินแล้วห้ามทับเด็ดขาด — ลบทิ้งเท่ากับหลักฐานการรับเงินหายไปด้วย
      if (existing.payment_status === 'Paid') {
        throw new ConflictException(
          `บ้านหลังนี้มีบิลเดือน ${billing_month}/${billing_year} ที่ชำระเงินแล้ว ไม่สามารถจดทับได้ครับ`,
        );
      }
      if (!params.replace) {
        throw new ConflictException(
          `บ้านหลังนี้ออกบิลเดือน ${billing_month}/${billing_year} ไปแล้ว (${Number(existing.total_amount).toLocaleString('th-TH')} บาท) ถ้าต้องการจดใหม่ให้กดจดทับของเดิมครับ`,
        );
      }
    }

    const targetKey = this.monthKey(period.year, period.month);
    const otherBills = (await this.billsOfMember(params.membersId)).filter(
      (b) => b.id !== existing?.id,
    );

    const laterBill = otherBills.find(
      (b) => this.monthKey(b.billing_year, b.billing_month) > targetKey,
    );
    if (laterBill) {
      // แทรกบิลย้อนหลังเข้าไปข้างหน้าใบที่ใหม่กว่า = ใบที่ใหม่กว่ามีเลขตั้งต้นผิดทันที
      throw new ConflictException(
        `บ้านหลังนี้มีบิลเดือน ${laterBill.billing_month}/${laterBill.billing_year} ซึ่งใหม่กว่าเดือนที่กำลังจะออกอยู่แล้ว ถ้าต้องการออกบิลย้อนหลังต้องลบบิลที่ใหม่กว่าออกก่อนครับ`,
      );
    }

    // อ่านไม่ชัด = เลขอาจผิดตั้งแต่ต้น ตรวจก่อนด่านอื่นที่พึ่งตัวเลขนี้ทั้งหมด
    // ด่านนี้จับเคสที่จำนวนหลักและหน่วยน้ำจับไม่ได้ (1250 → 1258)
    const read_confidence = this.assertReadingConfident({
      read_confidence: params.read_confidence,
      current_unit: params.current_unit,
      confirm_low_confidence: params.confirm_low_confidence,
    });

    // จำนวนหลักผิด = เลขผิดตั้งแต่ต้น ตรวจก่อนเอาไปคำนวณอะไรทั้งสิ้น
    // ตัดการจดของเดือนที่กำลังจะทับออก ไม่งั้นจะไปเทียบกับค่าที่อ่านผิดของรอบก่อน
    const meter_digits = this.assertDigitsLookSane({
      current_unit: params.current_unit,
      meter_digits: params.meter_digits,
      known_digits: await this.latestMeterDigits(
        params.membersId,
        existing?.meter_readings_id ?? params.excludeReadingId,
      ),
      confirm_digit_change: params.confirm_digit_change,
    });

    const baseline = await this.getPreviousUnit(
      params.membersId,
      billing_month,
      billing_year,
      params.excludeReadingId,
    );

    // มิเตอร์ตัวเก่าที่ถอดไปแล้วแต่หน่วยค้างยังไม่ได้คิดเงิน
    //
    // ═══ ทำไมต้องหาเอง ไม่รอให้หน้าเว็บส่ง old_meter_final_unit มา ═══
    //
    // คนที่เปลี่ยนมิเตอร์ (ช่าง/ผู้ใหญ่บ้าน) กับคนที่เดินจดรอบถัดไปมักไม่ใช่คนเดียวกัน
    // และห่างกันเป็นสัปดาห์ คนจดจึงไม่มีทางรู้เลขปิดของตัวที่ถูกถอดไปแล้ว
    // ถ้ารอให้กรอกมา หน่วยก้อนนั้นจะหายเงียบ ๆ ทุกครั้งที่เปลี่ยนมิเตอร์
    const pendingMeter = await this.meterRepository.findOne({
      where: {
        members_id: params.membersId,
        residual_billed_at: IsNull(),
        removed_at: Not(IsNull()),
        final_unit: Not(IsNull()),
      },
      order: { removed_at: 'DESC', id: 'DESC' },
    });

    // มิเตอร์ในกลุ่มที่ติดกัน: ตรวจด้วยตัวเลขว่าหยิบถูกตัวไหม — ต้องมาก่อน resolveUsage
    // ซึ่งจะโยน METER_ROLLBACK ("เพิ่งเปลี่ยนมิเตอร์ใช่ไหม") ออกไปก่อน ทั้งที่เคสจริง
    // ของกลุ่มนี้คือจดสลับตัวซ้าย/ตัวขวา ซึ่งมีทางแก้คนละทางกันเลย
    //
    // ทะเบียนมิเตอร์บอกว่าเพิ่งถอดตัวเก่า หรือคนยืนยันการเปลี่ยนมิเตอร์มาแล้ว = อีกเรื่อง
    // ปล่อยให้เป็นหน้าที่ของ resolveUsage ตามเดิม
    if (!params.confirm_meter_reset && !pendingMeter) {
      await this.assertClusterReadingFits({
        membersId: params.membersId,
        current_unit: params.current_unit,
        previous_unit: baseline.previous_unit,
        billing_month,
        billing_year,
      });
    }

    const { previous_unit, usage_unit, meter_reset } = this.resolveUsage({
      current_unit: params.current_unit,
      previous_unit: baseline.previous_unit,
      // ทะเบียนมิเตอร์มีบันทึกว่าถอดตัวเก่าไปแล้ว = ยืนยันการเปลี่ยนมิเตอร์ในตัว
      // ไม่ต้องให้คนหน้างานกดยืนยันซ้ำในสิ่งที่ระบบรู้อยู่แล้ว
      confirm_meter_reset: params.confirm_meter_reset || Boolean(pendingMeter),
      // ค่าที่คนกรอกมาเองชนะเสมอ — คนที่ยืนอยู่หน้ามิเตอร์เห็นของจริง
      old_meter_final_unit:
        params.old_meter_final_unit ?? pendingMeter?.final_unit ?? undefined,
    });

    // เดือนที่ข้ามไปไม่มีบิล = บิลใบนี้กินหลายเดือน ต้องรู้ก่อนตรวจด่านหน่วยพุ่ง
    // ไม่งั้นบิล 2 เดือนจะเด้ง 409 ทุกครั้งทั้งที่เลขถูก แล้วคนจะชินกับการกดผ่าน
    const period_months = this.periodMonthsFrom(
      baseline.bill,
      period.year,
      period.month,
    );

    // โหลดหมู่บ้านครั้งเดียว ใช้ทั้งเกณฑ์หน่วยพุ่งและรอบชำระ
    const village = await this.villageOfMember(params.membersId);

    const flags: PendingFlag[] = this.assertUsageLooksSane(
      usage_unit,
      otherBills,
      params.confirm_high_usage,
      period_months,
      this.thresholdsOf(village),
      params.confirmed_by,
    );

    // กรอกเลขเองต้องมีรูปเสมอ — ตรวจหลังด่านตัวเลขทั้งหมด เพราะเป็นเรื่องหลักฐาน
    // ไม่ใช่ความถูกต้องของตัวเลข ถ้าตรวจก่อนคนจะเห็นแต่ข้อความเรื่องรูป
    // ทั้งที่เลขที่กรอกมาผิดตั้งแต่ต้นอยู่แล้ว
    const entry_method = this.assertEntryMethod({
      entry_method: params.entry_method,
      has_photo: params.has_photo,
      read_confidence: params.read_confidence,
    });
    if (entry_method !== 'ocr') {
      flags.push({
        flag_type: 'manual_entry',
        detail: `กรอกเลข ${params.current_unit.toLocaleString('th-TH')} ด้วยมือ (${entry_method})`,
        confirmed_by: params.confirmed_by ?? null,
      });
    }
    if (meter_reset) {
      flags.push({
        flag_type: 'meter_reset',
        detail:
          `เลขที่จด ${params.current_unit} ต่ำกว่าเลขตั้งต้น ${baseline.previous_unit}` +
          (params.old_meter_final_unit !== undefined
            ? ` — เลขปิดมิเตอร์เก่า ${params.old_meter_final_unit}`
            : ' — ไม่ได้กรอกเลขปิดมิเตอร์เก่า คิดเฉพาะตัวใหม่'),
        confirmed_by: params.confirmed_by ?? null,
      });
    }
    if (params.confirm_digit_change) {
      flags.push({
        flag_type: 'digit_change',
        detail: `จำนวนหลักเปลี่ยนเป็น ${params.meter_digits ?? '-'} — กดยืนยันผ่าน`,
        confirmed_by: params.confirmed_by ?? null,
      });
    }
    if (params.confirm_low_confidence) {
      flags.push({
        flag_type: 'low_confidence',
        detail: `OCR มั่นใจ ${params.read_confidence ?? '-'} — กดยืนยันผ่าน`,
        confirmed_by: params.confirmed_by ?? null,
      });
    }

    const due_date = this.resolveDueDate(village, reading_date);

    // ยอดค้างสะสมของบ้านหลังนี้ ณ วินาทีนี้ — ตัดใบที่กำลังจะถูกจดทับออก
    // ไม่งั้นตอนกด "จดทับ" ยอดของใบเดิมจะถูกทบเข้าไปในใบที่มาแทนที่ตัวมันเอง
    const arrears = params.skip_arrears
      ? { arrears_amount: 0, covered: [] as BillEntity[] }
      : this.resolveArrears(otherBills);

    const total_amount = usage_unit * Number(rate.price_per_unit);

    return {
      rate,
      existing,
      reading_date,
      previous_unit,
      usage_unit,
      meter_reset,
      // ตรวจแล้วว่าเป็นจำนวนเต็มบวก (หรือ null เมื่อกรอกมือ) ลงคอลัมน์ tinyint ได้เลย
      meter_digits,
      // ปัดเป็น 3 ตำแหน่งแล้ว (หรือ null เมื่อกรอกมือ) ลงคอลัมน์ decimal(4,3) ได้เลย
      read_confidence,
      entry_method,
      period_months,
      due_date,
      village,
      /** มิเตอร์ตัวเก่าที่หน่วยค้างถูกคิดเข้าบิลใบนี้ — ผู้เรียกต้องมาร์กว่าคิดแล้ว */
      residual_meter: meter_reset ? pendingMeter : null,
      // ธงที่ต้องเขียนลง reading_flags พร้อมกับการจด (ผู้เรียกต้องส่งต่อเข้าทรานแซกชัน)
      flags,
      // ผู้เรียกต้องบันทึกสองค่านี้ ไม่ใช่ค่าดิบจาก dto
      billing_month,
      billing_year,
      // price_per_unit เป็น decimal ใน MySQL ซึ่ง TypeORM คืนมาเป็น string ('15.00') ต้องแปลงก่อนคูณ
      total_amount,
      arrears_amount: arrears.arrears_amount,
      arrears_covered: arrears.covered,
      grand_total: total_amount + arrears.arrears_amount,
    };
  }

  /**
   * ยอดค้างสะสมที่จะทบเข้าบิลใบใหม่ + รายชื่อใบเก่าที่ถูกทบ
   *
   * ═══ ทำไมต้องรู้ว่าทบใบไหนบ้าง ไม่ใช่แค่ยอดรวม ═══
   *
   * ตอนรับเงินต้องปิดใบเก่าทุกใบที่ถูกทบให้เป็น Paid ในทรานแซกชันเดียวกัน
   * ถ้าไม่ปิด ยอดเดิมจะถูกทบเข้าบิลเดือนถัดไปอีกรอบ กลายเป็นเก็บซ้ำจากก้อนที่จ่ายแล้ว
   *
   * ═══ ทำไมไม่บวกเข้า total_amount ไปเลย ═══
   *
   * usageBaseline(), outstandingByMember() และรายงานรายได้อ่าน total_amount ว่าเป็น
   * "ค่าน้ำของรอบเดียว" การเอายอดเก่าไปปนทำให้ยอดค้างถูกนับซ้ำทุกเดือนที่ทบต่อกันไป
   */
  private resolveArrears(unpaidCandidates: BillEntity[]): {
    arrears_amount: number;
    covered: BillEntity[];
  } {
    const covered = unpaidCandidates.filter(
      (bill) =>
        bill.payment_status === 'Pending' || bill.payment_status === 'Overdue',
    );

    return {
      // decimal ของ MySQL กลับมาเป็น string ต้องแปลงก่อนบวก ไม่งั้นได้การต่อสตริง
      arrears_amount: covered.reduce(
        (sum, bill) => sum + Number(bill.total_amount),
        0,
      ),
      covered,
    };
  }

  /**
   * เลขที่กรอกเองต้องมีรูปหน้าปัดแนบมาเสมอ — **บล็อกตาย ไม่มีปุ่มยืนยัน**
   *
   * ═══ ทำไมเข้มกว่าด่านอื่นทั้งหมด ═══
   *
   * ด่านอื่นเปิดปุ่มยืนยันไว้เพราะยังมีข้อมูลอีกชิ้นให้คนตรวจใช้ตัดสิน (รูป, ประวัติ,
   * จำนวนหลัก) แต่เลขที่กรอกมือแล้วไม่มีรูป **ไม่เหลืออะไรให้ตรวจเลยแม้แต่ชิ้นเดียว** —
   * ทั้งระบบต้องเชื่อตัวเลขที่พิมพ์มาล้วน ๆ ซึ่งเป็นสภาพเดียวกับการจดมือลงสมุด
   * ที่โปรเจกต์นี้ตั้งใจแก้ตั้งแต่ต้น
   *
   * ปุ่มยืนยันตรงนี้จึงไม่มีความหมาย — คนที่กดคือคนเดียวกับที่พิมพ์เลขมา
   */
  private assertEntryMethod(params: {
    entry_method?: string;
    has_photo?: boolean;
    read_confidence?: number;
  }): 'ocr' | 'manual' | 'manual_after_ocr_fail' {
    const declared = params.entry_method?.trim();
    const method =
      declared === 'manual' || declared === 'manual_after_ocr_fail'
        ? declared
        : declared === 'ocr'
          ? 'ocr'
          : // ไม่ประกาศมา = เดาจากว่ามีผล OCR ติดมาไหม เพื่อให้หน้าเว็บรุ่นเก่า
            // ที่ยังไม่ส่งฟิลด์นี้ยังทำงานได้เหมือนเดิม
            Number(params.read_confidence) > 0
            ? 'ocr'
            : 'manual';

    if (method !== 'ocr' && !params.has_photo) {
      throw new BadRequestException(
        billError(
          BILL_ERROR_CODES.MANUAL_PHOTO_REQUIRED,
          'การกรอกเลขมิเตอร์เองต้องแนบรูปหน้าปัดมาด้วยเสมอครับ — ไม่มีรูปแล้วจะไม่เหลือหลักฐานอะไรให้ตรวจสอบย้อนหลังได้เลย กรุณาถ่ายรูปหน้าปัดแล้วส่งมาพร้อมกัน',
          400,
        ),
      );
    }

    return method;
  }

  /**
   * พิกัดและเวลาที่กดชัตเตอร์ ในรูปแบบที่ลงคอลัมน์ของ meter_readings ได้แน่นอน
   *
   * ทั้งสี่ค่ามาจาก body ตรง ๆ และโปรเจกต์นี้ยังไม่ได้เปิด global ValidationPipe
   * ถ้าไม่ดักเองจะหลุดไปพังที่ MySQL เป็น 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง:
   *   - lat/lng นอกช่วง (พิมพ์ผิด หรือสลับสองค่ากัน ซึ่งเกิดบ่อยมาก) → error 1264
   *     คอลัมน์เป็น decimal(10,8)/decimal(11,8) มีที่ให้พอดีกับช่วงจริงเท่านั้น
   *   - captured_at ที่ไม่ใช่วันที่ → new Date() ได้ Invalid Date แล้ว MySQL เด้ง
   *     กรณีนี้ถือเป็น null ไปเลย ไม่บล็อกการออกบิล เพราะเป็นข้อมูลประกอบ
   *     ไม่ได้มีผลต่อยอดเงิน (ต่างจากพิกัดที่ผิดแล้วจะไปทำให้การจับคู่รูปเพี้ยน)
   *
   * เหตุผลเดียวกับ MemberService.assertCoordinates() แต่โยน BadRequestException
   * ให้เข้าชุดกับด่านอื่น ๆ ของการออกบิล
   */
  private parseLocation(dto: CreateBillFromScanDto): {
    latitude: number | null;
    longitude: number | null;
    gps_accuracy_m: number | null;
    captured_at: Date | null;
  } {
    const coordinate = (
      value: number | undefined,
      label: string,
      limit: number,
    ): number | null => {
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
    };

    const accuracy = Number(dto.gps_accuracy_m);
    const captured = dto.captured_at ? new Date(dto.captured_at) : null;

    return {
      latitude: coordinate(dto.latitude, 'ละติจูด', 90),
      longitude: coordinate(dto.longitude, 'ลองจิจูด', 180),
      // ความคลาดเคลื่อนติดลบไม่มีความหมาย ทิ้งไปเฉย ๆ ดีกว่าบล็อกการออกบิล
      gps_accuracy_m:
        Number.isFinite(accuracy) && accuracy >= 0
          ? Math.round(accuracy)
          : null,
      captured_at:
        captured && !Number.isNaN(captured.getTime()) ? captured : null,
    };
  }

  /**
   * บิลที่เกิดจากการจดซึ่งถือ client_uuid นี้อยู่แล้ว — null = ยังไม่เคยซิงก์เข้ามา
   *
   * ใช้ตอบคำขอที่ซ้ำจาก offline queue ด้วยผลลัพธ์เดิม แทนที่จะเป็น error
   * (การตอบ error ทำให้แอปเข้าใจว่ายังไม่สำเร็จแล้วยิงซ้ำไม่รู้จบ)
   */
  private async findBillByClientUuid(
    clientUuid?: string | null,
  ): Promise<BillEntity | null> {
    if (!clientUuid) return null;

    const reading = await this.meterReadingRepository.findOne({
      where: { client_uuid: clientUuid },
    });
    if (!reading) return null;

    return await this.billRepository.findOne({
      where: { meter_readings_id: reading.id },
    });
  }

  /** ผูกว่าบิลใบใหม่ทบยอดของใบเก่าใบไหนมาบ้าง (เรียกในทรานแซกชันเดียวกับบิล) */
  private async linkArrears(
    manager: EntityManager,
    billId: number,
    covered: BillEntity[],
  ): Promise<void> {
    if (covered.length === 0) return;

    await manager.save(
      covered.map((old) =>
        manager.create(BillArrearsEntity, {
          bill_id: billId,
          covered_bill_id: old.id,
          amount: Number(old.total_amount),
        }),
      ),
    );
  }

  /**
   * รับชำระเงินบิลใบหนึ่ง — ปิดใบเก่าที่ถูกทบยอดเข้ามาให้ด้วยทั้งชุด
   *
   * ═══ ทำไมปิดใบเก่าพร้อมกันในทรานแซกชันเดียว ═══
   *
   * ลูกบ้านจ่ายตามยอด grand_total ซึ่งรวมยอดค้างของใบเก่าไปแล้ว ถ้าปิดแค่ใบใหม่
   * ใบเก่าจะยังเป็น Pending อยู่ แล้วบิลเดือนถัดไปจะทบยอดเดิมเข้าไปอีกรอบ —
   * ลูกบ้านโดนเก็บซ้ำจากก้อนที่จ่ายไปแล้ว โดยไม่มีใครสังเกตจนกว่าจะมีคนมาทักท้วง
   *
   * ปิดแยกกันทีละใบไม่ได้ เพราะถ้าล้มกลางทางจะเหลือสภาพครึ่ง ๆ ที่แย่กว่าไม่ทำเลย
   */
  async payBill(id: number, paidBy?: number) {
    const bill = await this.billRepository.findOne({ where: { id } });
    if (!bill) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }
    if (bill.payment_status === 'Paid') {
      throw new ConflictException(`บิลหมายเลข ${id} ชำระเงินแล้วครับ`);
    }

    const links = await this.billArrearsRepository.find({
      where: { bill_id: id },
    });
    const coveredIds = links.map((link) => link.covered_bill_id);

    await this.billRepository.manager.transaction(async (manager) => {
      await manager.update(
        BillEntity,
        { id: In([id, ...coveredIds]) },
        { payment_status: 'Paid', modify_by: paidBy, modify_date: new Date() },
      );
    });

    return {
      message: `รับชำระเงินบิลหมายเลข ${id} เรียบร้อยครับ`,
      paid_amount: Number(bill.grand_total ?? bill.total_amount),
      /** บิลเก่าที่ถูกปิดไปพร้อมกัน เพราะยอดของใบพวกนี้ถูกทบไว้ในใบที่จ่าย */
      settled_bill_ids: coveredIds,
    };
  }

  /**
   * จดมิเตอร์ + ออกบิล ในคำสั่งเดียว
   *
   * ตรวจให้ผ่านก่อนค่อยเขียน แล้วเขียนทั้งสองตารางในทรานแซกชันเดียว
   * ถ้าล้มกลางทางจะไม่เหลือ meter_readings ค้าง และไม่มีบิลที่ไม่มีการจดรองรับ
   */
  async createFromScan(
    dto: CreateBillFromScanDto,
    /**
     * ส่วนเพิ่มสำหรับบิลปิดยอดตอนย้ายออก — เรียกจาก TenancyService เท่านั้น
     *
     * แยกเป็นพารามิเตอร์ที่สอง ไม่ปนใน dto เพราะสามค่านี้ต้องไม่มีทางมาจาก body
     * ของผู้ใช้ได้เลย (ตั้ง is_final เองจากหน้าเว็บ = ออกบิลที่ข้ามรอบชำระได้)
     */
    options?: {
      is_final?: boolean;
      tenancy_id?: number | null;
      /** ทับ due_date ที่คิดจากรอบชำระของหมู่บ้าน — บิลปิดยอดครบกำหนดวันย้ายออกเลย */
      due_date?: Date;
    },
  ) {
    // ═══ ยิงซ้ำจาก offline queue = คืนบิลใบเดิม ไม่ใช่ error ═══
    //
    // แอปที่ทำงานหน้างานเก็บการจดไว้ในเครื่องแล้วยิงตอนมีเน็ต ปัญหาคือ
    // "ยิงแล้วเน็ตหลุดก่อนได้รับคำตอบ" แยกไม่ออกจาก "ยิงไม่สำเร็จ" แอปจึงต้องยิงซ้ำ
    //
    // ตรวจตรงนี้เป็นแค่ทางลัดให้ตอบเร็ว — ตัวที่กันจริงคือ UNIQUE KEY ของ
    // client_uuid ในฐานข้อมูล เพราะสองคำขอที่มาพร้อมกันจะ SELECT ไม่เจอทั้งคู่
    const synced = await this.findBillByClientUuid(dto.client_uuid);
    if (synced) return synced;

    const prep = await this.prepareBill({
      membersId: dto.members_id,
      water_rates_id: dto.water_rates_id,
      current_unit: dto.current_unit,
      billing_month: dto.billing_month,
      billing_year: dto.billing_year,
      reading_date: dto.reading_date,
      replace: dto.replace,
      entry_method: dto.entry_method,
      has_photo: Boolean(dto.meter_photo),
      confirmed_by: dto.create_by ?? null,
      confirm_high_usage: dto.confirm_high_usage,
      confirm_meter_reset: dto.confirm_meter_reset,
      confirm_digit_change: dto.confirm_digit_change,
      old_meter_final_unit: dto.old_meter_final_unit,
      meter_digits: dto.meter_digits,
      read_confidence: dto.read_confidence,
      confirm_low_confidence: dto.confirm_low_confidence,
    });

    // ตรวจพิกัดก่อนเขียนไฟล์รูป — ตกด่านนี้แล้วจะได้ไม่มีไฟล์ค้างให้ต้องตามลบ
    const location = this.parseLocation(dto);

    // เวลาถ่ายที่เป็นอนาคตบล็อกตาย ส่วนที่เก่ากว่าหนึ่งวันติดธงไว้เฉย ๆ
    const flags: PendingFlag[] = [
      ...prep.flags,
      ...this.assertCapturedAtSane(location.captured_at),
    ];
    if (dto.confirm_duplicate_location) {
      flags.push({
        flag_type: 'duplicate_location',
        detail: `พิกัด ${location.latitude ?? '-'}, ${location.longitude ?? '-'} ซ้ำกับการจดที่มีอยู่ — กดยืนยันผ่าน`,
        confirmed_by: dto.create_by ?? null,
      });
    }
    if (dto.confirm_stale_photo) {
      flags.push({
        flag_type: 'stale_photo',
        detail: `รูปเก่ากว่าวันจดเกิน ${BillsService.STALE_PHOTO_DAYS} วัน — กดยืนยันผ่าน`,
        confirmed_by: dto.create_by ?? null,
      });
    }
    if (dto.client_uuid) {
      flags.push({
        flag_type: 'offline_sync',
        detail: `ซิงก์จากเครื่องที่บันทึกไว้ตอนไม่มีสัญญาณ (${dto.client_uuid})`,
      });
    }

    // ด่านกันรูปเก่า/รูปใช้ซ้ำ — ต้องอยู่หลัง parseLocation (ใช้ค่าที่แปลงแล้ว)
    // และก่อนเขียนไฟล์ ด้วยเหตุผลเดียวกับด่านพิกัด
    this.assertPhotoNotStale({
      captured_at: location.captured_at,
      reading_date: prep.reading_date,
      confirm_stale_photo: dto.confirm_stale_photo,
    });

    await this.assertPhotoNotReused({
      membersId: dto.members_id,
      latitude: location.latitude,
      longitude: location.longitude,
      captured_at: location.captured_at,
      // ตอนกดจดทับ การจดของเดือนเดิมยังอยู่ในตาราง ถ้าไม่ตัดออกจะฟ้องว่าซ้ำกับตัวเอง
      excludeReadingId: prep.existing?.meter_readings_id,
      confirm_duplicate_location: dto.confirm_duplicate_location,
    });

    // เขียนไฟล์รูปก่อนเข้าทรานแซกชัน — การเขียนดิสก์ย้อนกลับพร้อม rollback ไม่ได้
    // ถ้า DB ล้มทีหลังต้องตามลบไฟล์เอง (ดู catch ข้างล่าง) ไม่งั้นเหลือไฟล์ที่ไม่มีใครอ้างถึง
    const photoPath = dto.meter_photo
      ? await this.meterPhotoService.save(dto.meter_photo, dto.members_id)
      : null;

    // รูปของการจดครั้งก่อนที่ถูกทับ — ลบไฟล์จริงหลัง commit สำเร็จเท่านั้น
    // ถ้าลบก่อนแล้ว rollback รูปเดิมจะหายทั้งที่บิลยังอยู่
    let replacedPhoto: string | null = null;

    let bill: BillEntity;
    try {
      const result = await this.billRepository.manager.transaction(
        async (manager) => {
          // สั่งทับ = ลบใบเดิม + การจดที่ผูกอยู่ทิ้งก่อน
          let orphanedPhoto: string | null = null;
          if (prep.existing) {
            const oldBill = prep.existing;
            await manager.delete(BillEntity, oldBill.id);
            const stillUsed = await manager.count(BillEntity, {
              where: { meter_readings_id: oldBill.meter_readings_id },
            });
            // ⚠️ เก็บ path ไว้ลบ "เฉพาะตอนที่แถวการจดถูกลบจริง" เท่านั้น
            //    ถ้ามีบิลใบอื่นใช้การจดครั้งเดียวกันอยู่ แถวนั้นจะไม่ถูกลบ —
            //    ลบไฟล์ทิ้งตอนนั้นเท่ากับ evidence_photo ในฐานข้อมูลชี้ไปไฟล์ที่ไม่มีแล้ว
            //    (remove() ข้างล่างทำถูกอยู่แล้ว ตรงนี้เคยลบนอกเงื่อนไข)
            if (stillUsed === 0) {
              const oldReading = await manager.findOne(MeterReadingEntity, {
                where: { id: oldBill.meter_readings_id },
              });
              orphanedPhoto = oldReading?.evidence_photo ?? null;
              await manager.delete(
                MeterReadingEntity,
                oldBill.meter_readings_id,
              );
            }
          }

          const now = new Date();

          // มิเตอร์ตัวที่ใช้อยู่ตอนนี้ของบ้านหลังนี้ — ไม่มีทะเบียนก็ปล่อย null
          // (บ้านที่ยังไม่เคยลงทะเบียนมิเตอร์ยังออกบิลได้ตามปกติ)
          const activeMeter = await manager.findOne(MeterEntity, {
            where: { members_id: dto.members_id, removed_at: IsNull() },
            order: { installed_at: 'DESC', id: 'DESC' },
          });

          const reading = await manager.save(
            manager.create(MeterReadingEntity, {
              // ตรวจและแปลงมาแล้วใน prepareBill() — ไม่แปลงซ้ำที่นี่
              reading_date: prep.reading_date,
              meter_unit: dto.current_unit,
              members_id: dto.members_id,
              meters_id: activeMeter?.id ?? null,
              create_by: dto.create_by,
              create_date: now,
              // ตรวจแล้วใน prepareBill() — null เมื่อกรอกเลขเอง ไม่ได้ผ่าน OCR
              meter_digits: prep.meter_digits,
              // เก็บไว้เป็นหลักฐานว่าตอนออกบิลระบบมั่นใจแค่ไหน ไม่ใช่แค่ตรวจแล้วทิ้ง
              read_confidence: prep.read_confidence,
              entry_method: prep.entry_method,
              // รหัสจากมือถือ — UNIQUE ระดับ DB คือสิ่งที่กันบิลซ้ำตอน auto-sync จริง
              client_uuid: dto.client_uuid ?? null,
              // รูปผูกกับ "การจดครั้งนี้" ไม่ใช่กับบิล เพราะบิลออกใหม่ทับได้
              // แต่การจดคือเหตุการณ์ที่เกิดครั้งเดียวและรูปเป็นหลักฐานของเหตุการณ์นั้น
              ...(photoPath ? { evidence_photo: photoPath } : {}),
              // พิกัดจุดที่ยืนถ่าย — สะสมไว้ให้ระบบเรียนรู้ว่ามิเตอร์บ้านนี้อยู่ตรงไหนจริง
              // ตรวจมาแล้วใน parseLocation() ค่าที่นี่จึงลงคอลัมน์ decimal ได้แน่นอน
              ...location,
            }),
          );

          // ธงต้องอยู่ในทรานแซกชันเดียวกับการจด ไม่งั้นจะเหลือธงที่ชี้ไปแถวที่ rollback ไปแล้ว
          // (หรือแย่กว่า: บิลผ่านแต่ธงหาย = บิลที่ดูสะอาดทั้งที่กดข้ามด่านมา)
          await this.readingFlagsService.record(manager, reading.id, flags);

          const newBill = manager.create(BillEntity, {
            meter_readings_id: reading.id,
            water_rates_id: dto.water_rates_id,
            previous_unit: prep.previous_unit,
            current_unit: dto.current_unit,
            usage_unit: prep.usage_unit,
            total_amount: prep.total_amount,
            // ยอดค้างเก่าแยกคอลัมน์ ไม่ปนกับค่าน้ำของเดือนนี้ (ดูคอมเมนต์ใน BillEntity)
            arrears_amount: prep.arrears_amount,
            grand_total: prep.grand_total,
            // เติมศูนย์แล้วจาก prepareBill ไม่ใช่ค่าดิบจาก dto
            billing_month: prep.billing_month,
            billing_year: prep.billing_year,
            due_date: options?.due_date ?? prep.due_date,
            period_months: prep.period_months,
            tenancy_id: options?.tenancy_id ?? null,
            is_final: options?.is_final ? 1 : 0,
            payment_status: 'Pending' as const,
            create_by: dto.create_by,
            create_date: now,
          });

          const saved = await manager.save(newBill);

          // ผูกว่าบิลใบนี้ทบยอดของใบไหนมาบ้าง — ตอนรับเงินต้องปิดใบเก่าทั้งชุด
          await this.linkArrears(manager, saved.id, prep.arrears_covered);

          // มาร์กว่าหน่วยค้างของมิเตอร์ตัวเก่าถูกคิดไปแล้ว ไม่งั้นบิลเดือนหน้า
          // จะบวกก้อนเดิมเข้าไปอีก (เก็บซ้ำทุกเดือนจนกว่าจะมีคนสังเกต)
          if (prep.residual_meter) {
            await manager.update(MeterEntity, prep.residual_meter.id, {
              residual_billed_at: now,
              residual_bill_id: saved.id,
            });
          }

          return { bill: saved, orphanedPhoto };
        },
      );
      bill = result.bill;
      replacedPhoto = result.orphanedPhoto;
    } catch (error) {
      // บิลไม่ได้ออก รูปที่เพิ่งเขียนจึงไม่มีเจ้าของ เก็บกวาดก่อนโยน error ต่อ
      await this.meterPhotoService.remove(photoPath);
      throw error;
    }

    await this.meterPhotoService.remove(replacedPhoto);
    return bill;
  }

  /** ค่าจาก multipart มาเป็นสตริงเสมอ — 'true'/'1'/'on' ถือว่าติ๊กมา นอกนั้นไม่ */
  private static asFlag(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value !== 'string') return false;

    const text = value.trim().toLowerCase();
    return text === 'true' || text === '1' || text === 'on';
  }

  /** ค่าที่ผู้ใช้ส่งมา ในรูปแบบที่เอาไปใส่ข้อความ error ได้โดยไม่กลายเป็น [object Object] */
  private static asText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  /** วันที่จาก DB มาได้ทั้ง Date และสตริง 'YYYY-MM-DD' — เทียบกับ "วันนี้" ตามเวลาเครื่อง */
  private static isToday(value: Date | string | null | undefined): boolean {
    if (!value) return false;
    const pad = (n: number) => String(n).padStart(2, '0');
    const local = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const text =
      value instanceof Date ? local(value) : String(value).slice(0, 10);
    return text === local(new Date());
  }

  /**
   * ใครแก้เลขมิเตอร์ของบิลใบไหนได้บ้าง
   *
   * ═══ ทำไม staff ถึงถูกจำกัด ═══
   *
   * การแก้เลขมิเตอร์คือการเปลี่ยนยอดเงินของใบที่ออกไปแล้ว คนเดินจดต้องแก้ของ
   * ที่เพิ่งจดผิดเมื่อกี้ได้ (ไม่งั้นต้องรอ owner ว่างทุกครั้งที่พิมพ์เลขพลาด)
   * แต่ **ไม่ควรแก้ใบที่เลยกำหนดชำระไปแล้ว** ซึ่งเป็นใบที่คนกำลังตามเก็บเงินอยู่ —
   * ยอดที่ขยับตอนนั้นคือยอดที่ไม่มีใครสังเกต
   *
   * owner แก้ได้ตลอดเพราะเป็นคนที่ต้องรับผิดชอบเมื่อลูกบ้านทักท้วงย้อนหลัง
   */
  private assertMayEditReading(
    bill: BillEntity,
    reading: MeterReadingEntity,
    adminRole: AdminRole,
  ): void {
    if (adminRole === 'owner') return;

    if (
      BillsService.isToday(reading.reading_date) ||
      bill.payment_status === 'Pending'
    ) {
      return;
    }

    throw new ForbiddenException(
      `บิลเดือน ${bill.billing_month}/${bill.billing_year} ใบนี้เลยกำหนดชำระไปแล้วและไม่ได้จดวันนี้ ต้องให้เจ้าของระบบเป็นคนแก้ครับ`,
    );
  }

  /**
   * แก้เลขมิเตอร์ของบิลที่ออกไปแล้ว แล้วคิดยอดใหม่ทั้งสาย
   *
   * ═══ ทำไมไม่ใช้ "จดทับ" (POST /bills/scan ด้วย replace) แทน ═══
   *
   * จดทับ = ลบบิลใบเดิมกับการจดทิ้งแล้วสร้างใหม่ ซึ่งทำให้ id เปลี่ยน ร่องรอยเดิมหาย
   * และต้องส่งข้อมูลการจดมาครบทั้งชุด (พิกัด เวลาถ่าย ความมั่นใจ OCR) ทั้งที่คนแก้
   * นั่งอยู่หน้าคอม ไม่ได้ยืนอยู่หน้ามิเตอร์ ทางนี้จึงแก้เฉพาะ "ตัวเลขที่อ่านผิด"
   * โดยคงหลักฐานของการเดินไปจดครั้งนั้นไว้ทั้งหมด
   *
   * ═══ อะไรที่ตั้งใจไม่แตะ ═══
   *
   *   - พิกัด/เวลาถ่าย — รูปที่แนบมาผ่านการครอปจากหน้าเว็บแล้วจึงไม่มี EXIF
   *     เอามาอัปเดตอะไรไม่ได้เลย และการเดินไปจดเกิดขึ้นจริงตามพิกัดเดิม
   *   - ยอดค้าง (arrears_amount) ของใบนี้เอง — เป็นภาพนิ่งของใบเก่า ณ วันออกบิล
   *     ไม่เกี่ยวกับเลขที่อ่านผิด แต่ **ใบที่ทบยอดใบนี้ไปแล้วต้องถูกคิดใหม่** (ดูข้างล่าง)
   */
  async updateReading(
    billId: number,
    input: {
      current_unit: unknown;
      reason?: string;
      /** รูปหน้าปัดใหม่เป็น data URL — ไม่ส่งมา = ใช้รูปเดิมต่อ */
      photo?: string | null;
      confirm_high_usage?: unknown;
      confirm_meter_reset?: unknown;
    },
    actor: { id: number | null; admin_role: AdminRole },
  ): Promise<{
    usage_unit: number;
    total_amount: number;
    grand_total: number;
  }> {
    const bill = await this.billRepository.findOne({ where: { id: billId } });
    if (!bill) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${billId}`);
    }

    // เหตุผลต้องมาก่อนทุกอย่าง — ตกด่านนี้แล้วจะได้ไม่มีอะไรถูกแตะเลย
    const reason = (input.reason ?? '').trim();
    if (!reason) {
      throw new BadRequestException(
        'กรุณาระบุเหตุผลที่แก้เลขมิเตอร์ครับ — การแก้ยอดเงินที่ไม่มีเหตุผลกำกับจะตรวจสอบย้อนหลังไม่ได้เลย',
      );
    }
    if (reason.length > 500) {
      throw new BadRequestException(
        'เหตุผลยาวเกินไป กรุณาสรุปให้อยู่ใน 500 ตัวอักษรครับ',
      );
    }

    const current_unit = Number(input.current_unit);
    if (!Number.isInteger(current_unit) || current_unit < 0) {
      throw new BadRequestException(
        `เลขมิเตอร์ "${BillsService.asText(input.current_unit)}" ไม่ถูกต้อง ต้องเป็นจำนวนเต็มไม่ติดลบครับ`,
      );
    }

    // จ่ายเงินแล้วห้ามแก้ **แม้จะเป็น owner** — ยอดที่ลูกบ้านจ่ายไปแล้วต้องตรงกับ
    // ใบที่ถืออยู่เสมอ ถ้าจะแก้จริงต้องกดปรับสถานะกลับเป็นรอชำระก่อน ซึ่งเป็นการ
    // ตัดสินใจแยกอีกครั้งที่ทิ้งร่องรอยไว้เอง (และทำให้เห็นว่ามีการเปิดใบที่ปิดไปแล้ว)
    if (bill.payment_status === 'Paid') {
      throw new ConflictException(
        billError(
          BILL_ERROR_CODES.BILL_PAID,
          `บิลหมายเลข ${billId} ชำระเงินแล้ว แก้เลขมิเตอร์ไม่ได้ครับ — ถ้าต้องแก้จริงให้กดปรับสถานะกลับเป็น "รอชำระเงิน" ก่อน`,
          409,
        ),
      );
    }

    const reading = await this.meterReadingRepository.findOne({
      where: { id: bill.meter_readings_id },
    });
    if (!reading) {
      throw new NotFoundException(
        `ไม่พบการจดมิเตอร์ของบิลหมายเลข ${billId} — บิลใบนี้เสียหาย กรุณาแจ้งผู้ดูแลระบบครับ`,
      );
    }

    this.assertMayEditReading(bill, reading, actor.admin_role);

    const rate = await this.waterRateRepository.findOne({
      where: { id: bill.water_rates_id },
    });
    if (!rate) {
      throw new NotFoundException('ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ');
    }

    const confirm_high_usage = BillsService.asFlag(input.confirm_high_usage);
    const confirm_meter_reset = BillsService.asFlag(input.confirm_meter_reset);

    // เลขตั้งต้นของเดือนนี้ — ตัดการจดของบิลใบนี้เองออก ไม่งั้นจะเอาเลขที่กำลังแก้
    // มาเป็นตัวตั้งของตัวเอง
    const baseline = await this.getPreviousUnit(
      reading.members_id,
      bill.billing_month,
      bill.billing_year,
      reading.id,
    );

    // หน่วยค้างของมิเตอร์ตัวเก่าที่ถูกคิดเข้า **บิลใบนี้** ไปแล้วตอนออกบิล
    // ถ้าไม่เอากลับมาบวก การแก้เลขจะทำให้ก้อนนั้นหายเงียบ ๆ (ลูกบ้านได้ส่วนลดฟรี
    // จากการที่ OCR เคยอ่านผิด ซึ่งไม่ใช่เจตนาของการแก้)
    const residualMeter = await this.meterRepository.findOne({
      where: { residual_bill_id: bill.id },
    });
    const residual =
      residualMeter?.final_unit != null
        ? Math.max(0, residualMeter.final_unit - baseline.previous_unit)
        : 0;

    let previous_unit = baseline.previous_unit;
    let usage_unit: number;
    let meter_reset = false;

    if (current_unit >= previous_unit) {
      usage_unit = current_unit - previous_unit;
    } else {
      if (!confirm_meter_reset) {
        throw new BadRequestException({
          statusCode: 400,
          message: `เลขมิเตอร์ที่แก้ (${current_unit.toLocaleString('th-TH')}) น้อยกว่าเลขตั้งต้นของเดือนก่อน (${previous_unit.toLocaleString('th-TH')}) กรุณาตรวจสอบอีกครั้งครับ — ถ้าเปลี่ยนมิเตอร์ใหม่ หรือมิเตอร์นับครบรอบแล้ววนกลับเป็น 0 ให้กดยืนยันการเปลี่ยนมิเตอร์`,
          code: READING_EDIT_ERROR_CODES.METER_RESET,
        });
      }
      // เริ่มนับจาก 0 เหมือนตอนออกบิล แล้วบวกหน่วยค้างของตัวเก่ากลับเข้าไป
      previous_unit = 0;
      usage_unit = current_unit + residual;
      meter_reset = true;
    }

    // ด่านหน่วยพุ่ง — ใช้ตัวเดียวกับตอนออกบิลเป๊ะ ๆ เพื่อให้เกณฑ์สองทางไม่มีวันเพี้ยนจากกัน
    // แล้วแปลง 409/HIGH_USAGE เป็น 400/high_usage ตามสัญญาของหน้าแก้บิล
    const otherBills = (await this.billsOfMember(reading.members_id)).filter(
      (b) => b.id !== bill.id,
    );
    const village = await this.villageOfMember(reading.members_id);

    let flags: PendingFlag[];
    try {
      flags = this.assertUsageLooksSane(
        usage_unit,
        otherBills,
        confirm_high_usage,
        bill.period_months,
        this.thresholdsOf(village),
        actor.id,
      );
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;

      const body = error.getResponse() as { message?: string };
      throw new BadRequestException({
        statusCode: 400,
        message: body?.message ?? 'หน่วยน้ำที่คำนวณได้สูงผิดปกติ',
        code: READING_EDIT_ERROR_CODES.HIGH_USAGE,
      });
    }

    if (meter_reset) {
      flags.push({
        flag_type: 'meter_reset',
        detail: `แก้เลขเป็น ${current_unit} ซึ่งต่ำกว่าเลขตั้งต้น ${baseline.previous_unit} — กดยืนยันผ่านตอนแก้บิล`,
        confirmed_by: actor.id ?? null,
      });
    }
    // เลขที่ถูกพิมพ์เข้ามาเองไม่ได้ผ่าน OCR แล้ว ต้องทิ้งร่องรอยไว้เหมือนการกรอกมือปกติ
    flags.push({
      flag_type: 'manual_entry',
      detail: `แก้เลขมิเตอร์ ${reading.meter_unit} → ${current_unit} (${reason})`,
      confirmed_by: actor.id ?? null,
    });

    const old_total_amount = Number(bill.total_amount);
    const total_amount = usage_unit * Number(rate.price_per_unit);
    const arrears_amount = Number(bill.arrears_amount ?? 0);
    const grand_total = total_amount + arrears_amount;

    // เขียนไฟล์รูปก่อนเข้าทรานแซกชัน ด้วยเหตุผลเดียวกับ createFromScan()
    const photoPath = input.photo
      ? await this.meterPhotoService.save(input.photo, reading.members_id)
      : null;
    const oldPhoto = reading.evidence_photo ?? null;

    try {
      await this.billRepository.manager.transaction(async (manager) => {
        const now = new Date();

        await manager.update(MeterReadingEntity, reading.id, {
          meter_unit: current_unit,
          // เลขนี้มาจากคนพิมพ์แล้ว ไม่ใช่ผลของ OCR อีกต่อไป — ต้องล้าง meter_digits
          // และ read_confidence ทิ้งด้วย ไม่งั้นเดือนหน้าด่านจำนวนหลักจะเอาค่าที่ OCR
          // อ่านได้ตอนที่ "อ่านผิด" มาเป็นตัวเทียบ แล้วบล็อกการจดที่ถูกต้อง
          meter_digits: null,
          read_confidence: null,
          entry_method: 'manual',
          ...(photoPath
            ? // มีรูปใหม่ = หลักฐานชุดใหม่ ต้องล้าง photo_purged_at ด้วย
              // ไม่งั้นหน้าเว็บจะไม่ขึ้นรูปให้ทั้งที่ไฟล์อยู่ครบ
              { evidence_photo: photoPath, photo_purged_at: null }
            : {}),
          modify_by: actor.id ?? undefined,
          modify_date: now,
        });

        await manager.update(BillEntity, bill.id, {
          previous_unit,
          current_unit,
          usage_unit,
          total_amount,
          grand_total,
          modify_by: actor.id ?? undefined,
        });

        // ธงของการแก้ผูกกับการจดครั้งเดิม — หน้าสอบทานจะได้เห็นทั้งตอนออกบิล
        // และตอนที่มีคนมาแก้ทีหลัง เรียงต่อกันบนการจดใบเดียวกัน
        await this.readingFlagsService.record(manager, reading.id, flags);

        await this.recalcArrearsCovering(manager, bill.id, total_amount);

        await this.readingLogsService.record(manager, {
          bills_id: bill.id,
          meter_readings_id: reading.id,
          members_id: reading.members_id,
          old_unit: Number(reading.meter_unit),
          new_unit: current_unit,
          old_usage_unit: Number(bill.usage_unit),
          new_usage_unit: usage_unit,
          old_total_amount,
          new_total_amount: total_amount,
          reason,
          photo_replaced: Boolean(photoPath),
          confirmed_flags: [
            ...(confirm_high_usage
              ? [READING_EDIT_ERROR_CODES.HIGH_USAGE as string]
              : []),
            ...(confirm_meter_reset
              ? [READING_EDIT_ERROR_CODES.METER_RESET as string]
              : []),
          ],
          changed_by: actor.id ?? null,
          changed_role: actor.admin_role,
        });
      });
    } catch (error) {
      // การแก้ไม่สำเร็จ รูปที่เพิ่งเขียนจึงไม่มีเจ้าของ เก็บกวาดก่อนโยน error ต่อ
      await this.meterPhotoService.remove(photoPath);
      throw error;
    }

    // รูปเดิมถูกแทนที่แล้วและ commit ผ่าน — ลบไฟล์ทิ้งได้
    if (photoPath) {
      await this.meterPhotoService.remove(oldPhoto);
    }

    return { usage_unit, total_amount, grand_total };
  }

  /**
   * บิลใบใหม่ที่ทบยอดของใบที่เพิ่งถูกแก้ ต้องถูกคิดยอดใหม่ตามไปด้วย
   *
   * ═══ ทำไมต้องไล่แก้ต่อ ═══
   *
   * bill_arrears.amount เป็นสำเนายอดของใบเก่า ณ วันที่ทบ ถ้าแก้ใบเก่าแล้วไม่ตามแก้
   * ลูกบ้านจะเห็นบิลเดือนล่าสุดที่ทบ "ยอดที่ไม่มีอยู่จริงแล้ว" มา — และเวลาไปกดรับเงิน
   * ระบบจะปิดใบเก่าที่ยอดไม่ตรงกับที่เก็บมาจริง
   *
   * ข้ามใบที่จ่ายเงินไปแล้ว: ยอดบนใบที่ปิดไปแล้วคือยอดที่รับเงินมาจริง แก้ทีหลัง
   * เท่ากับเขียนประวัติการรับเงินใหม่ (ปกติเคสนี้ไม่เกิด เพราะการรับเงินปิดใบเก่า
   * ให้เป็น Paid ทั้งชุด แล้วใบที่ Paid ก็แก้ไม่ได้ตั้งแต่ต้นทางอยู่แล้ว)
   */
  private async recalcArrearsCovering(
    manager: EntityManager,
    coveredBillId: number,
    newAmount: number,
  ): Promise<void> {
    const links = await manager.find(BillArrearsEntity, {
      where: { covered_bill_id: coveredBillId },
    });
    if (links.length === 0) return;

    for (const link of links) {
      const laterBill = await manager.findOne(BillEntity, {
        where: { id: link.bill_id },
      });
      if (!laterBill || laterBill.payment_status === 'Paid') continue;

      await manager.update(BillArrearsEntity, link.id, { amount: newAmount });

      // คิดยอดค้างของใบนั้นใหม่จากลิงก์ทั้งชุด ไม่ใช่บวก/ลบส่วนต่าง
      // เพราะใบเดียวทบมาจากหลายใบได้ และการบวกส่วนต่างจะสะสมความคลาดไปเรื่อย ๆ
      const siblings = await manager.find(BillArrearsEntity, {
        where: { bill_id: laterBill.id },
      });
      const arrears_amount = siblings.reduce(
        (sum, row) =>
          sum + (row.id === link.id ? newAmount : Number(row.amount)),
        0,
      );

      await manager.update(BillEntity, laterBill.id, {
        arrears_amount,
        grand_total: Number(laterBill.total_amount) + arrears_amount,
      });
    }
  }

  // ฟังก์ชันสร้างบิลพร้อมคำนวณอัตโนมัติ
  async create(createBillDto: CreateBillDto) {
    // 1. เดือน/ปีต้องใช้งานได้ก่อน ทุกด่านข้างล่างเทียบลำดับเดือนจากสองค่านี้
    //    ใช้ค่าที่เติมศูนย์แล้วตลอดทั้งฟังก์ชัน ไม่ใช่ createBillDto.billing_* ดิบ ๆ
    const { billing_month, billing_year, month, year } =
      this.normalizeBillingPeriod(
        createBillDto.billing_month,
        createBillDto.billing_year,
      );

    // 2. ดึงเรทค่าน้ำจาก Database มาเพื่อความชัวร์ (ไม่เชื่อใจราคาที่อาจถูกส่งมาจากหน้าบ้าน)
    const rate = await this.waterRateRepository.findOne({
      where: { id: createBillDto.water_rates_id },
    });

    if (!rate) {
      throw new NotFoundException('ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ');
    }

    // 2.5 กันออกบิลซ้ำเดือน — 1 บ้าน ต้องมีบิลได้เดือนละใบเดียวเท่านั้น
    //     ถ้าไม่กัน สแกนบ้านเดิมสองรอบในเดือนเดียวจะได้บิลสองใบ ลูกบ้านโดนเก็บซ้ำ
    //     และใบที่สองจะเอาเลขของการสแกนรอบแรกมาเป็นตัวตั้ง ยอดเลยเกือบศูนย์
    const reading = await this.meterReadingRepository.findOne({
      where: { id: createBillDto.meter_readings_id },
    });
    if (!reading) {
      throw new NotFoundException('ไม่พบข้อมูลการจดมิเตอร์ที่อ้างถึง');
    }

    const existing = await this.findByMemberAndMonth(
      reading.members_id,
      billing_month,
      billing_year,
    );

    if (existing) {
      // จ่ายเงินแล้วห้ามทับเด็ดขาด — ลบทิ้งเท่ากับหลักฐานการรับเงินหายไปด้วย
      // ต้องให้คนตัดสินใจเอง (ปรับสถานะกลับเป็นค้างชำระก่อน แล้วค่อยจดใหม่)
      if (existing.payment_status === 'Paid') {
        throw new ConflictException(
          `บ้านหลังนี้มีบิลเดือน ${billing_month}/${billing_year} ที่ชำระเงินแล้ว ไม่สามารถจดทับได้ครับ`,
        );
      }

      if (!createBillDto.replace) {
        throw new ConflictException(
          `บ้านหลังนี้ออกบิลเดือน ${billing_month}/${billing_year} ไปแล้ว (${Number(existing.total_amount).toLocaleString('th-TH')} บาท) ถ้าต้องการจดใหม่ให้กดจดทับของเดิมครับ`,
        );
      }

      // สั่งทับ = ลบใบเดิมทิ้งก่อน (remove() ลบการจดมิเตอร์ที่ผูกอยู่ให้ด้วย
      // ถ้าปล่อยไว้ บิลเดือนถัดไปจะเอาเลขของใบที่ถูกลบมาเป็นตัวตั้ง)
      await this.remove(existing.id);
    }

    // 2.6 หาเลขตั้งต้นเอง ไม่เชื่อ previous_unit ที่หน้าเว็บส่งมา
    //     หน้าเว็บเดิมส่ง "การจดครั้งล่าสุด" มาเสมอ ซึ่งผิดทันทีที่จดย้อนหลัง:
    //     ออกบิล ก.ค. (2000→2439) แล้วย้อนไปออกบิล มิ.ย. จะได้ 2000→2439 ซ้ำอีกใบ
    //     บ้านหลังนั้นโดนเก็บค่าน้ำก้อนเดียวกันสองรอบ
    //     ตัวตั้งที่ถูกคือ "เลขปิดของบิลเดือนก่อนหน้าเดือนที่กำลังออก"
    const targetKey = this.monthKey(year, month);
    const otherBills = (await this.billsOfMember(reading.members_id)).filter(
      (b) => b.id !== existing?.id,
    );

    const laterBill = otherBills.find(
      (b) => this.monthKey(b.billing_year, b.billing_month) > targetKey,
    );
    if (laterBill) {
      // ถ้ายอมให้แทรกบิลย้อนหลังเข้าไปข้างหน้าใบที่ใหม่กว่า ใบที่ใหม่กว่าจะมีเลขตั้งต้นผิดทันที
      // และต้องคิดใหม่ทั้งสาย — บล็อกไว้ให้ลบใบที่ใหม่กว่าออกก่อนตรงไปตรงมากว่า
      throw new ConflictException(
        `บ้านหลังนี้มีบิลเดือน ${laterBill.billing_month}/${laterBill.billing_year} ซึ่งใหม่กว่าเดือนที่กำลังจะออกอยู่แล้ว ถ้าต้องการออกบิลย้อนหลังต้องลบบิลที่ใหม่กว่าออกก่อนครับ`,
      );
    }

    const { previous_unit, bill: previousBill } = await this.getPreviousUnit(
      reading.members_id,
      billing_month,
      billing_year,
      createBillDto.meter_readings_id,
    );

    if (createBillDto.current_unit < previous_unit) {
      throw new BadRequestException(
        `เลขมิเตอร์ที่จด (${createBillDto.current_unit}) น้อยกว่าเลขปิดของเดือนก่อน (${previous_unit}) กรุณาตรวจสอบตัวเลขอีกครั้งครับ`,
      );
    }

    // 3. คำนวณหาหน่วยที่ใช้ไป และยอดเงินรวม
    // price_per_unit เป็น decimal ใน MySQL ซึ่ง TypeORM คืนมาเป็น string ('15.00') ต้องแปลงก่อนคูณ
    const usage_unit = createBillDto.current_unit - previous_unit;

    // 3.5 ด่านกันเลขที่ AI อ่านผิด — เคยมีบิลที่ 50,000 กลายเป็น 252,131 (3 ล้านบาท) หลุดไปแล้ว
    //     เทียบกับหน่วยที่บ้านหลังนี้ใช้ตามปกติ บ้านใหม่ที่ยังไม่มีประวัติใช้เพดานตายตัวแทน
    //     หารด้วยคาบบิลก่อน ไม่งั้นบิลที่กินหลายเดือนจะเด้งทั้งที่เลขถูก
    const period_months = this.periodMonthsFrom(previousBill, year, month);

    const village = await this.villageOfMember(reading.members_id);

    // ทางนี้ไม่ได้สร้างการจดใหม่ (อ้างแถวที่มีอยู่แล้ว) จึงไม่มีที่ให้ติดธง —
    // ธงผูกกับ meter_readings.id และแถวนั้นเกิดไปก่อนหน้านี้แล้ว
    // ด่านที่บล็อกยังทำงานครบเหมือนเดิม ต่างแค่ไม่มีร่องรอยของการกดผ่าน
    this.assertUsageLooksSane(
      usage_unit,
      otherBills,
      createBillDto.confirm_high_usage,
      period_months,
      this.thresholdsOf(village),
    );

    const due_date = this.resolveDueDate(village, reading.reading_date);

    const total_amount = usage_unit * Number(rate.price_per_unit);

    // ยอดค้างสะสมของบ้านหลังนี้ — ทางนี้กับ createFromScan ต้องคิดเหมือนกัน
    // ไม่งั้นบิลที่ออกจากสองหน้าจอจะมียอดบนใบเสร็จไม่ตรงกัน
    const arrears = this.resolveArrears(otherBills);

    // 4. นำข้อมูลมาผูกรวมกัน โดยบังคับใช้ยอดที่เราคำนวณเอง
    //    ตัด replace / confirm_high_usage ทิ้งก่อน เป็นคำสั่งของ request ไม่ใช่คอลัมน์ในตาราง
    const {
      replace: _replace,
      confirm_high_usage: _confirm,
      ...billFields
    } = createBillDto;
    const newBill = this.billRepository.create({
      ...billFields,
      previous_unit: previous_unit, // เขียนทับด้วยเลขปิดของเดือนก่อนที่หาเอง
      usage_unit: usage_unit, // เขียนทับด้วยค่าที่คำนวณได้
      total_amount: total_amount, // เขียนทับด้วยยอดเงินที่ถูกต้อง
      arrears_amount: arrears.arrears_amount, // ยอดค้างเก่า แยกจากค่าน้ำเดือนนี้เสมอ
      grand_total: total_amount + arrears.arrears_amount,
      billing_month, // เขียนทับด้วยค่าที่เติมศูนย์แล้ว ('8' → '08')
      billing_year,
      due_date, // คิดจากวันจด + รอบชำระของหมู่บ้าน ไม่รับจาก body
      period_months, // นับจากช่องว่างถึงบิลใบก่อน ไม่รับจาก body
      // 🌟 กำหนดค่าเองให้ชัดเจน กัน payment_status = NULL และ create_date = 0000-00-00
      payment_status: createBillDto.payment_status ?? 'Pending',
      create_date: new Date(),
    });

    // 5. บันทึกบิลและการผูกยอดค้างในทรานแซกชันเดียว
    //    ถ้าบิลบันทึกสำเร็จแต่การผูกล้ม จะเหลือบิลที่เก็บยอดค้างไปแล้วโดยไม่มีใครรู้ว่า
    //    ทบมาจากใบไหน แล้วตอนรับเงินก็จะปิดใบเก่าไม่ได้ — ยอดเดิมถูกทบซ้ำในเดือนถัดไป
    return await this.billRepository.manager.transaction(async (manager) => {
      const saved = await manager.save(newBill);
      await this.linkArrears(manager, saved.id, arrears.covered);
      return saved;
    });
  }

  // 🌟 ตาราง bills เก็บแค่ meter_readings_id หน้าเว็บเลยไม่รู้ว่าบิลนี้เป็นของบ้านหลังไหน
  //    ต้อง join ผ่าน meter_readings ไปหา members (และดึงเรทค่าน้ำมาโชว์ในหน้ารายละเอียดด้วย)
  //
  // getRawAndEntities() คืน raw เป็น any ถ้าไม่ระบุชนิด — ประกาศ BillDetailRow กำกับไว้
  // เพื่อให้ TypeScript จับได้เวลาพิมพ์ชื่อคอลัมน์ raw ผิด (เช่น member_housno)
  private billDetailQuery() {
    return (
      this.billRepository
        .createQueryBuilder('bill')
        .leftJoin(
          MeterReadingEntity,
          'reading',
          'reading.id = bill.meter_readings_id',
        )
        .leftJoin(MemberEntity, 'member', 'member.id = reading.members_id')
        .leftJoin(WaterRateEntity, 'rate', 'rate.id = bill.water_rates_id')
        // ที่อยู่หมู่บ้านติดมากับบิลเลย เพราะบิลถูกพิมพ์จากทั้งฝั่งแอดมินและพอร์ทัลลูกบ้าน
        // แต่ /villages เป็นสิทธิ์ admin ลูกบ้านจึงไปดึงเองไม่ได้ ถ้าไม่แนบมาตรงนี้
        // ใบเสร็จของสองฝั่งจะมีที่อยู่ไม่เหมือนกัน
        .leftJoin(VillageEntity, 'village', 'village.id = member.villages_id')
        .leftJoin(
          SubdistrictEntity,
          'subdistrict',
          'subdistrict.id = village.subdistricts_id',
        )
        .leftJoin(
          DistrictEntity,
          'district',
          'district.id = village.districts_id',
        )
        .leftJoin(
          ProvinceEntity,
          'province',
          'province.id = village.provinces_id',
        )
        .addSelect([
          'reading.id',
          'reading.reading_date',
          'reading.meter_unit',
          // path รูปหน้าปัด (สั้น ๆ ไม่กี่สิบตัวอักษร) ดึงมาพร้อมบิลได้ไม่หนัก
          'reading.evidence_photo',
          'member.id',
          'member.house_no',
          'member.fname',
          'member.lname',
          'member.phone',
          'rate.price_per_unit',
          'village.id',
          'village.village_name',
          'village.village_no',
          'village.zip_code',
          'subdistrict.name_in_thai',
          'district.name_in_thai',
          'province.name_in_thai',
        ])
    );
  }

  // รวมข้อมูลบิล + ลูกบ้าน + เรทค่าน้ำ ให้เป็นก้อนเดียวที่หน้าเว็บใช้ได้เลย
  private toDetail(bill: BillEntity, row: BillDetailRow | undefined) {
    return {
      ...bill,
      // decimal ของ MySQL กลับมาเป็น string ต้องแปลงก่อนส่งให้หน้าเว็บ
      price_per_unit:
        row?.rate_price_per_unit != null
          ? Number(row.rate_price_per_unit)
          : null,
      meter_reading: row?.reading_id
        ? {
            id: row.reading_id,
            reading_date: row.reading_reading_date,
            meter_unit: row.reading_meter_unit,
            // ตั้งชื่อ meter_photo ให้หน้าเว็บ ไม่ส่งชื่อคอลัมน์ evidence_photo ออกไปตรง ๆ
            // (เป็นแนวเดียวกับที่ API เปลี่ยน members_id1 → members_id และ creat_date → create_date)
            meter_photo: row.reading_evidence_photo ?? null,
          }
        : null,
      member: row?.member_id
        ? {
            id: row.member_id,
            house_no: row.member_house_no,
            fname: row.member_fname,
            lname: row.member_lname,
            phone: row.member_phone,
            // หมู่บ้านของบ้านหลังนี้ — ส่งชื่อไทยของตำบล/อำเภอ/จังหวัดมาเลย
            // ไม่ส่งแค่ id เพราะใบเสร็จต้องพิมพ์เป็นข้อความ ถ้าให้หน้าเว็บไปแปลงเอง
            // ต้องยิง /locations เพิ่มอีกสามรอบต่อการพิมพ์หนึ่งครั้ง
            village: row.village_id
              ? {
                  id: row.village_id,
                  village_name: row.village_village_name,
                  village_no: row.village_village_no,
                  subdistrict: row.subdistrict_name_in_thai ?? null,
                  district: row.district_name_in_thai ?? null,
                  province: row.province_name_in_thai ?? null,
                  zip_code: row.village_zip_code ?? null,
                }
              : null,
          }
        : null,
    };
  }

  /**
   * ดีดบิลที่เลยกำหนดชำระให้เป็น Overdue — เรียกก่อนอ่านรายการบิลทุกครั้ง
   *
   * ═══ ทำไมทำตอนอ่าน ไม่ใช่ cron ═══
   *
   * โปรเจกต์นี้ยังไม่มี scheduler และการเพิ่ม cron หมายถึงต้องมี process ที่รันค้าง
   * ตลอดเวลา ซึ่งเป็นภาระเกินจำเป็นสำหรับหมู่บ้านเดียว การอัปเดตตอนอ่านให้ผลเหมือนกัน
   * เพราะสถานะที่ไม่มีใครเปิดดูก็ไม่มีความหมาย และคิวรีนี้แตะเฉพาะแถวที่เข้าเงื่อนไข
   * (มี index ที่ payment_status ก็ยิ่งถูก) จึงไม่ได้แพงจนต้องเลี่ยง
   *
   * ไม่แตะบิลที่ due_date เป็น NULL — บิลเก่าก่อน migration ไม่มีกำหนดชำระที่เชื่อได้
   * และไม่แตะ 'Paid' เด็ดขาด จ่ายแล้วต่อให้จ่ายช้าก็คือจ่ายแล้ว
   */
  async markOverdue(): Promise<number> {
    const result = await this.billRepository
      .createQueryBuilder()
      .update(BillEntity)
      .set({ payment_status: 'Overdue' })
      .where('payment_status = :pending', { pending: 'Pending' })
      .andWhere('due_date IS NOT NULL')
      .andWhere('due_date < CURDATE()')
      .execute();

    return result.affected ?? 0;
  }

  // ดูบิลทั้งหมด (พร้อมข้อมูลลูกบ้านเจ้าของบิล)
  async findAll() {
    await this.markOverdue();

    const { entities, raw } = await this.billDetailQuery()
      .orderBy('bill.create_date', 'DESC')
      .getRawAndEntities<BillDetailRow>();

    return entities.map((bill, index) => this.toDetail(bill, raw[index]));
  }

  // ดูบิลของ "บ้านที่ระบุ" เท่านั้น — ใช้โดยพอร์ทัลลูกบ้าน (เห็นเฉพาะบ้านตัวเอง)
  //    memberIds มาจากตาราง account_members ของบัญชีที่ล็อกอินอยู่ ไม่ใช่จากผู้ใช้ส่งมาเอง
  async findAllForMembers(memberIds: number[]) {
    if (memberIds.length === 0) return [];

    await this.markOverdue();

    const { entities, raw } = await this.billDetailQuery()
      .where('member.id IN (:...memberIds)', { memberIds })
      .orderBy('bill.create_date', 'DESC')
      .getRawAndEntities<BillDetailRow>();

    return entities.map((bill, index) => this.toDetail(bill, raw[index]));
  }

  /**
   * ยอดค้างสะสมรายบ้าน — เรียงบ้านที่ค้างหนักสุดขึ้นก่อน
   *
   * ของเดิมบ้านที่ค้าง 6 เดือนเห็นเป็นบิล Pending 6 ใบกระจายอยู่ในตารางรวม
   * ต้องกวาดตาหาเองว่าเป็นของบ้านเดียวกัน แล้วบวกเลขในหัว — ซึ่งเป็นสิ่งที่
   * คนเก็บเงินต้องทำทุกครั้งก่อนออกไปทวง
   */
  async outstandingByMember(villagesId?: number) {
    await this.markOverdue();

    const rows = await this.billRepository
      .createQueryBuilder('bill')
      .innerJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .innerJoin(MemberEntity, 'member', 'member.id = reading.members_id1')
      .select('member.id', 'members_id')
      .addSelect('member.house_no', 'house_no')
      .addSelect('member.fname', 'fname')
      .addSelect('member.lname', 'lname')
      .addSelect('member.phone', 'phone')
      .addSelect('COUNT(bill.id)', 'unpaid_bills')
      .addSelect('SUM(bill.total_amount)', 'outstanding_amount')
      .addSelect('MIN(bill.due_date)', 'oldest_due_date')
      .addSelect(
        `SUM(CASE WHEN bill.payment_status = 'Overdue' THEN 1 ELSE 0 END)`,
        'overdue_bills',
      )
      .where('bill.payment_status IN (:...unpaid)', {
        unpaid: ['Pending', 'Overdue'],
      })
      .andWhere(
        villagesId ? 'member.villages_id = :villagesId' : '1=1',
        villagesId ? { villagesId } : {},
      )
      .groupBy('member.id')
      .orderBy('outstanding_amount', 'DESC')
      .getRawMany<{
        members_id: number;
        house_no: string;
        fname: string | null;
        lname: string | null;
        phone: string | null;
        unpaid_bills: string;
        overdue_bills: string;
        outstanding_amount: string;
        oldest_due_date: Date | null;
      }>();

    // COUNT/SUM ของ MySQL กลับมาเป็น string ผ่าน getRawMany ต้องแปลงก่อนส่งออก
    // ไม่งั้นหน้าเว็บเอาไปบวกกันจะได้การต่อสตริง ('120' + '80' = '12080')
    return rows.map((row) => ({
      members_id: Number(row.members_id),
      house_no: row.house_no,
      name: `${row.fname ?? ''} ${row.lname ?? ''}`.trim(),
      phone: row.phone,
      unpaid_bills: Number(row.unpaid_bills),
      overdue_bills: Number(row.overdue_bills),
      outstanding_amount: Number(row.outstanding_amount),
      oldest_due_date: row.oldest_due_date,
    }));
  }

  /**
   * บ้านที่ยังไม่มีบิลของเดือนที่ระบุ — ไล่ดูว่าเดินจดตกบ้านไหนไปบ้าง
   *
   * ไม่มีตัวนี้ "เดือนที่ข้ามไป" จะไม่มีใครรู้จนกว่าจะไปโผล่เป็นบิลสองเดือนรวมกัน
   * ในเดือนถัดไป ซึ่งตอนนั้นแก้อะไรไม่ได้แล้ว — ต้องรู้ตั้งแต่ยังอยู่ในเดือนนั้น
   *
   * `last_billed` บอกว่าบ้านหลังนี้มีบิลล่าสุดเมื่อไหร่ เพื่อแยกสองกรณีที่ต่างกันมาก:
   * บ้านที่แค่ยังไม่ได้จดรอบนี้ กับบ้านที่หายไปจากระบบมาหลายเดือนแล้ว
   */
  async findMissingBills(
    billing_month: string,
    billing_year: string,
    villagesId?: number,
  ) {
    const period = this.normalizeBillingPeriod(billing_month, billing_year);
    const targetKey = this.monthKey(period.year, period.month);

    const members = await this.memberRepository.find({
      where: villagesId ? { villages_id: villagesId } : {},
      order: { house_no: 'ASC' },
    });
    if (members.length === 0) return [];

    const billsByMember = await this.billsOfMembers(members.map((m) => m.id));

    const missing: {
      members_id: number;
      house_no: string;
      name: string;
      phone: string | null;
      last_billed: string | null;
      months_since_last_bill: number | null;
    }[] = [];
    for (const member of members) {
      const bills = billsByMember.get(member.id) ?? [];
      if (
        bills.some(
          (b) => this.monthKey(b.billing_year, b.billing_month) === targetKey,
        )
      ) {
        continue;
      }

      // billsOfMembers เรียงเดือนเก่า→ใหม่มาแล้ว ใบท้ายสุดคือใบล่าสุด
      const last = bills[bills.length - 1] ?? null;
      missing.push({
        members_id: member.id,
        house_no: member.house_no,
        name: `${member.fname ?? ''} ${member.lname ?? ''}`.trim(),
        phone: member.phone ?? null,
        last_billed: last ? `${last.billing_month}/${last.billing_year}` : null,
        // ขาดไปกี่เดือนนับจากบิลล่าสุด — 1 คือแค่ยังไม่ได้จดรอบนี้
        months_since_last_bill: last
          ? this.monthIndex(period.year, period.month) -
            this.monthIndex(last.billing_year, last.billing_month)
          : null,
      });
    }

    return missing;
  }

  // ดูบิลตาม ID (พร้อมข้อมูลลูกบ้านเจ้าของบิล)
  async findOne(id: number) {
    await this.markOverdue();

    const { entities, raw } = await this.billDetailQuery()
      .where('bill.id = :id', { id })
      .getRawAndEntities<BillDetailRow>();

    if (!entities.length) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }
    return this.toDetail(entities[0], raw[0]);
  }

  async updateStatus(id: number, payment_status: string) {
    // 🌟 ของเดิมยัด as any ส่งเข้า DB ตรง ๆ ค่าที่สะกดผิดจะเด้งเป็น 500 จาก MySQL
    //    (หรือถ้าไม่มีบิลใบนั้นก็เงียบ ๆ คืน null) ตรวจเองที่นี่ให้ได้ข้อความไทยแทน
    const status = PAYMENT_STATUSES.find((value) => value === payment_status);
    if (!status) {
      throw new BadRequestException(
        `สถานะการชำระเงินไม่ถูกต้อง (ต้องเป็น ${PAYMENT_STATUSES.join(' / ')})`,
      );
    }

    const bill = await this.billRepository.findOne({ where: { id } });
    if (!bill) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }

    await this.billRepository.update(id, { payment_status: status });

    return await this.billRepository.findOne({ where: { id } });
  }

  async remove(id: number) {
    const bill = await this.billRepository.findOne({ where: { id } });
    if (!bill) {
      throw new NotFoundException(`ไม่พบบิลหมายเลข ${id}`);
    }

    // 🔒 บิลที่ชำระเงินแล้วห้ามลบ — เหตุผลเดียวกับที่ห้ามจดทับใน prepareBill()
    //    ของเดิมกันแค่ทางจดทับ แต่ทางลบเปิดทิ้งไว้ ทั้งที่ปลายทางร้ายแรงกว่า:
    //    ลบแล้วหายทั้งบิล ทั้งการจดมิเตอร์ และ **ไฟล์รูปหลักฐานบนดิสก์** (ข้างล่าง)
    //    ไม่เหลืออะไรให้กู้ว่าเคยเก็บเงินบ้านหลังนี้ไปแล้วจริง
    if (bill.payment_status === 'Paid') {
      throw new ConflictException(
        `บิลหมายเลข ${id} ชำระเงินแล้ว ลบไม่ได้ครับ — การลบจะทำให้หลักฐานการรับเงินและรูปมิเตอร์หายถาวร ถ้าต้องการลบจริงให้เปลี่ยนสถานะกลับเป็นค้างชำระก่อน`,
      );
    }

    // 🌟 บิลเกิดจากการจดมิเตอร์ 1 ครั้ง — ถ้าลบบิลแต่ทิ้งการจดไว้
    //    เลขมิเตอร์ "ครั้งก่อน" ของบ้านนั้นจะยังอ้างเลขที่ถูกยกเลิกไปแล้ว ทำให้บิลใบถัดไปคำนวณเพี้ยน
    //    จึงลบเป็นชุดเดียวกันใน transaction (เช็คก่อนว่าไม่มีบิลใบอื่นใช้การจดครั้งเดียวกันอยู่)
    let removedPhoto: string | null = null;

    await this.billRepository.manager.transaction(async (manager) => {
      await manager.delete(BillEntity, id);

      const otherBills = await manager.count(BillEntity, {
        where: { meter_readings_id: bill.meter_readings_id },
      });
      if (otherBills === 0) {
        // อ่าน path รูปไว้ก่อนลบแถว แล้วค่อยลบไฟล์หลัง commit
        const reading = await manager.findOne(MeterReadingEntity, {
          where: { id: bill.meter_readings_id },
        });
        removedPhoto = reading?.evidence_photo ?? null;

        await manager.delete(MeterReadingEntity, bill.meter_readings_id);
      }
    });

    await this.meterPhotoService.remove(removedPhoto);

    return { message: `ลบบิล ID ${id} สำเร็จเรียบร้อย!` };
  }
}
