import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillEntity, PAYMENT_STATUSES } from 'src/entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity'; // ปรับ Path ให้ตรงกับโฟลเดอร์ของคุณ
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { CreateBillDto } from 'src/dto/create-bill.dto';
import { CreateBillFromScanDto } from 'src/dto/create-bill-from-scan.dto';
import { MeterPhotoService } from './meter-photo.service';

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

    private readonly meterPhotoService: MeterPhotoService,
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

  learnedMeterLocations(
    readings: MeterReadingEntity[],
  ): Map<number, { latitude: number; longitude: number; samples: number }> {
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
      { latitude: number; longitude: number; samples: number }
    >();
    for (const [membersId, bucket] of byMember) {
      if (bucket.lat.length < BillsService.MIN_READINGS_FOR_REFERENCE) continue;
      result.set(membersId, {
        latitude: median(bucket.lat),
        longitude: median(bucket.lng),
        samples: bucket.lat.length,
      });
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
        /** หน่วยน้ำที่บ้านนี้เคยใช้ (เฉพาะเดือนก่อนหน้าเดือนเป้าหมาย) */
        usage_history: number[];
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

      result.set(membersId, {
        previous_unit: resolved.previous_unit,
        source: resolved.source,
        usage_history: bills
          .filter(
            (b) => this.monthKey(b.billing_year, b.billing_month) < targetKey,
          )
          .map((b) => Number(b.usage_unit))
          .filter((u) => u > 0),
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
  /** กี่เท่าของค่าเฉลี่ยจึงถือว่าผิดปกติ */
  static readonly USAGE_SPIKE_RATIO = 5;
  /** ต่ำกว่านี้ไม่ถือว่าผิดปกติแม้จะเกินอัตราส่วน (บ้านที่ปกติใช้ 2 หน่วย) */
  static readonly USAGE_SPIKE_FLOOR = 50;

  /**
   * กันเลขมิเตอร์ที่ AI อ่านผิดจนออกบิลมหาศาล
   *
   * ไม่บล็อกตายตัว เพราะบางทีก็ใช้เยอะจริง (ท่อแตก/เปิดลืม) แต่ต้องให้คนยืนยันก่อน
   * ไม่ใช่ผ่านไปเงียบ ๆ แล้วไปโผล่เป็นบิลที่ลูกบ้านต้องจ่าย
   */
  private assertUsageLooksSane(
    usage_unit: number,
    previousBills: BillEntity[],
    confirmHighUsage?: boolean,
  ) {
    if (confirmHighUsage) return;

    const history = previousBills
      .map((b) => Number(b.usage_unit))
      .filter((u) => u > 0);

    if (history.length > 0) {
      const avg = history.reduce((sum, u) => sum + u, 0) / history.length;
      // ต้องเกิน 50 หน่วยด้วย ไม่งั้นบ้านที่ปกติใช้ 2 หน่วย พอใช้ 11 หน่วยก็เด้งแล้ว
      if (
        usage_unit > avg * BillsService.USAGE_SPIKE_RATIO &&
        usage_unit > BillsService.USAGE_SPIKE_FLOOR
      ) {
        throw new ConflictException(
          `หน่วยน้ำที่คำนวณได้ (${usage_unit.toLocaleString('th-TH')} หน่วย) สูงกว่าที่บ้านหลังนี้เคยใช้มาก (เฉลี่ย ${Math.round(avg).toLocaleString('th-TH')} หน่วย) กรุณาตรวจสอบเลขมิเตอร์อีกครั้ง ถ้าถูกต้องแล้วให้กดยืนยันครับ`,
        );
      }
      return;
    }

    if (usage_unit > BillsService.USAGE_HARD_CAP) {
      throw new ConflictException(
        `หน่วยน้ำที่คำนวณได้ (${usage_unit.toLocaleString('th-TH')} หน่วย) สูงผิดปกติ กรุณาตรวจสอบเลขมิเตอร์อีกครั้ง ถ้าถูกต้องแล้วให้กดยืนยันครับ`,
      );
    }
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
    old_meter_final_unit?: number;
    excludeReadingId?: number;
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

    const baseline = await this.getPreviousUnit(
      params.membersId,
      billing_month,
      billing_year,
      params.excludeReadingId,
    );

    const { previous_unit, usage_unit, meter_reset } = this.resolveUsage({
      current_unit: params.current_unit,
      previous_unit: baseline.previous_unit,
      confirm_meter_reset: params.confirm_meter_reset,
      old_meter_final_unit: params.old_meter_final_unit,
    });

    this.assertUsageLooksSane(
      usage_unit,
      otherBills,
      params.confirm_high_usage,
    );

    return {
      rate,
      existing,
      reading_date,
      previous_unit,
      usage_unit,
      meter_reset,
      // ผู้เรียกต้องบันทึกสองค่านี้ ไม่ใช่ค่าดิบจาก dto
      billing_month,
      billing_year,
      // price_per_unit เป็น decimal ใน MySQL ซึ่ง TypeORM คืนมาเป็น string ('15.00') ต้องแปลงก่อนคูณ
      total_amount: usage_unit * Number(rate.price_per_unit),
    };
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
   * จดมิเตอร์ + ออกบิล ในคำสั่งเดียว
   *
   * ตรวจให้ผ่านก่อนค่อยเขียน แล้วเขียนทั้งสองตารางในทรานแซกชันเดียว
   * ถ้าล้มกลางทางจะไม่เหลือ meter_readings ค้าง และไม่มีบิลที่ไม่มีการจดรองรับ
   */
  async createFromScan(dto: CreateBillFromScanDto) {
    const prep = await this.prepareBill({
      membersId: dto.members_id,
      water_rates_id: dto.water_rates_id,
      current_unit: dto.current_unit,
      billing_month: dto.billing_month,
      billing_year: dto.billing_year,
      reading_date: dto.reading_date,
      replace: dto.replace,
      confirm_high_usage: dto.confirm_high_usage,
      confirm_meter_reset: dto.confirm_meter_reset,
      old_meter_final_unit: dto.old_meter_final_unit,
    });

    // ตรวจพิกัดก่อนเขียนไฟล์รูป — ตกด่านนี้แล้วจะได้ไม่มีไฟล์ค้างให้ต้องตามลบ
    const location = this.parseLocation(dto);

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
          const reading = await manager.save(
            manager.create(MeterReadingEntity, {
              // ตรวจและแปลงมาแล้วใน prepareBill() — ไม่แปลงซ้ำที่นี่
              reading_date: prep.reading_date,
              meter_unit: dto.current_unit,
              members_id: dto.members_id,
              create_by: dto.create_by,
              create_date: now,
              // รูปผูกกับ "การจดครั้งนี้" ไม่ใช่กับบิล เพราะบิลออกใหม่ทับได้
              // แต่การจดคือเหตุการณ์ที่เกิดครั้งเดียวและรูปเป็นหลักฐานของเหตุการณ์นั้น
              ...(photoPath ? { evidence_photo: photoPath } : {}),
              // พิกัดจุดที่ยืนถ่าย — สะสมไว้ให้ระบบเรียนรู้ว่ามิเตอร์บ้านนี้อยู่ตรงไหนจริง
              // ตรวจมาแล้วใน parseLocation() ค่าที่นี่จึงลงคอลัมน์ decimal ได้แน่นอน
              ...location,
            }),
          );

          const newBill = manager.create(BillEntity, {
            meter_readings_id: reading.id,
            water_rates_id: dto.water_rates_id,
            previous_unit: prep.previous_unit,
            current_unit: dto.current_unit,
            usage_unit: prep.usage_unit,
            total_amount: prep.total_amount,
            // เติมศูนย์แล้วจาก prepareBill ไม่ใช่ค่าดิบจาก dto
            billing_month: prep.billing_month,
            billing_year: prep.billing_year,
            payment_status: 'Pending' as const,
            create_by: dto.create_by,
            create_date: now,
          });

          return { bill: await manager.save(newBill), orphanedPhoto };
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

    const { previous_unit } = await this.getPreviousUnit(
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
    //     เทียบกับค่าเฉลี่ยที่บ้านหลังนี้เคยใช้ บ้านใหม่ที่ยังไม่มีประวัติใช้เพดานตายตัวแทน
    this.assertUsageLooksSane(
      usage_unit,
      otherBills,
      createBillDto.confirm_high_usage,
    );

    const total_amount = usage_unit * Number(rate.price_per_unit);

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
      billing_month, // เขียนทับด้วยค่าที่เติมศูนย์แล้ว ('8' → '08')
      billing_year,
      // 🌟 กำหนดค่าเองให้ชัดเจน กัน payment_status = NULL และ create_date = 0000-00-00
      payment_status: createBillDto.payment_status ?? 'Pending',
      create_date: new Date(),
    });

    // 5. บันทึกลง Database
    return await this.billRepository.save(newBill);
  }

  // 🌟 ตาราง bills เก็บแค่ meter_readings_id หน้าเว็บเลยไม่รู้ว่าบิลนี้เป็นของบ้านหลังไหน
  //    ต้อง join ผ่าน meter_readings ไปหา members (และดึงเรทค่าน้ำมาโชว์ในหน้ารายละเอียดด้วย)
  //
  // getRawAndEntities() คืน raw เป็น any ถ้าไม่ระบุชนิด — ประกาศ BillDetailRow กำกับไว้
  // เพื่อให้ TypeScript จับได้เวลาพิมพ์ชื่อคอลัมน์ raw ผิด (เช่น member_housno)
  private billDetailQuery() {
    return this.billRepository
      .createQueryBuilder('bill')
      .leftJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = bill.meter_readings_id',
      )
      .leftJoin(MemberEntity, 'member', 'member.id = reading.members_id')
      .leftJoin(WaterRateEntity, 'rate', 'rate.id = bill.water_rates_id')
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
      ]);
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
          }
        : null,
    };
  }

  // ดูบิลทั้งหมด (พร้อมข้อมูลลูกบ้านเจ้าของบิล)
  async findAll() {
    const { entities, raw } = await this.billDetailQuery()
      .orderBy('bill.create_date', 'DESC')
      .getRawAndEntities<BillDetailRow>();

    return entities.map((bill, index) => this.toDetail(bill, raw[index]));
  }

  // ดูบิลของ "บ้านที่ระบุ" เท่านั้น — ใช้โดยพอร์ทัลลูกบ้าน (เห็นเฉพาะบ้านตัวเอง)
  //    memberIds มาจากตาราง account_members ของบัญชีที่ล็อกอินอยู่ ไม่ใช่จากผู้ใช้ส่งมาเอง
  async findAllForMembers(memberIds: number[]) {
    if (memberIds.length === 0) return [];

    const { entities, raw } = await this.billDetailQuery()
      .where('member.id IN (:...memberIds)', { memberIds })
      .orderBy('bill.create_date', 'DESC')
      .getRawAndEntities<BillDetailRow>();

    return entities.map((bill, index) => this.toDetail(bill, raw[index]));
  }

  // ดูบิลตาม ID (พร้อมข้อมูลลูกบ้านเจ้าของบิล)
  async findOne(id: number) {
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
