import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberEntity } from '../entity/member.entity';
import { BillsService } from './bills.service';
import { MeterReadingsService } from './meter-readings.service';
import { PhotoMetadata, PhotoMetadataService } from './photo-metadata.service';
import { ScanBatchDto } from '../dto/scan-batch.dto';

/** ความมั่นใจว่ารูปใบนี้เป็นของบ้านที่เสนอ */
export type MatchConfidence = 'high' | 'medium' | 'ambiguous' | 'none';

export interface Candidate {
  members_id: number;
  house_no: string;
  name: string;
  previous_unit: number;
  usage_unit: number;
  /** ค่าเฉลี่ยที่บ้านหลังนี้เคยใช้ (null = ยังไม่มีประวัติ) */
  average_usage: number | null;
  already_billed: boolean;
  /** 0-1 ยิ่งสูงยิ่งเข้าเค้า */
  score: number;
  /**
   * ระยะจากจุดที่ถ่ายรูปถึงพิกัดบ้านหลังนี้ (เมตร)
   * null = รูปไม่มีพิกัด หรือบ้านหลังนี้ยังไม่ได้กรอกพิกัดไว้
   */
  distance_m: number | null;
}

/** ผลการวิเคราะห์รูปหนึ่งใบ */
export interface ScanBatchItem {
  index: number;
  filename: string;
  reading: {
    success: boolean;
    meter_unit: number | null;
    confidence: number;
    full_reading?: string | null;
  };
  /** วันเวลา + พิกัดที่อ่านได้จาก EXIF ของไฟล์รูป */
  photo_taken: PhotoMetadata;
  confidence: MatchConfidence;
  reason: string;
  /** คำเตือนที่ไม่ถึงขั้นบล็อก เช่น วันถ่ายไม่ตรงเดือนบิล หรือถ่ายไกลจากบ้าน */
  warnings: string[];
  /** บ้านที่ระบบเสนอ — null เมื่อแยกไม่ออกหรืออ่านเลขไม่ได้ */
  suggestion: Candidate | null;
  candidates: Candidate[];
}

/**
 * จับคู่ "รูปมิเตอร์" กับ "บ้าน" จากเลขที่อ่านได้
 *
 * ═══ ทำไมใช้เลขมิเตอร์ ไม่ใช่ GPS ═══
 *
 * เลขมิเตอร์เป็นยอดสะสมตั้งแต่วันติดตั้ง ไม่ได้รีเซ็ตทุกเดือน แต่ละบ้านจึงมีเลข
 * ที่ห่างกันมากตามอายุการใช้งาน (บ้านหนึ่ง 1,250 อีกบ้าน 3,891) เลขที่อ่านได้จากรูป
 * จึงชี้กลับไปหาบ้านต้นทางได้เองด้วยเงื่อนไขสองข้อ:
 *
 *   1. ห้ามติดลบ  — มิเตอร์เดินหน้าอย่างเดียว เลขใหม่ต้อง ≥ เลขตั้งต้นของบ้านนั้น
 *   2. หน่วยที่ใช้ต้องสมเหตุสมผล — เทียบกับที่บ้านหลังนั้นเคยใช้จริง
 *
 * GPS ทำแบบนี้ไม่ได้ เพราะบ้านในหมู่บ้านห่างกัน 8-20 เมตร ขณะที่ GPS มือถือ
 * คลาดเคลื่อน 10-30 เมตรเป็นปกติ รัศมีที่กว้างพอจะไม่ปฏิเสธคนถ่ายถูกบ้าน
 * ย่อมครอบบ้านข้างเคียงไปด้วยเสมอ
 *
 * ═══ สิ่งที่ service นี้ไม่ทำ ═══
 *
 * ไม่เขียนอะไรลงฐานข้อมูล และไม่ตัดสินใจแทนคน — คืนอันดับผู้สมัครพร้อมเหตุผล
 * ให้คนกดยืนยัน เพราะเดิมพันคือเงินที่ลูกบ้านต้องจ่าย และมีเคสที่เลขอย่างเดียว
 * แยกไม่ออกจริง ๆ (บ้านใหม่ที่ยังไม่มีประวัติ, บ้านที่เลขมิเตอร์ใกล้กัน)
 */
@Injectable()
export class ScanBatchService {
  private readonly logger = new Logger(ScanBatchService.name);

  /** อัปเกินนี้ต่อครั้งไม่ให้ทำ — OCR ทีละใบ ยิ่งเยอะยิ่งกิน RAM และรอนาน */
  static readonly MAX_FILES = 30;

  /**
   * ระยะที่ถือว่า "ถ่ายอยู่ที่บ้านหลังนี้จริง"
   * GPS มือถือคลาดเคลื่อน 10-30 ม. เป็นปกติ จึงตั้งไว้กว้างกว่านั้นเล็กน้อย
   */
  static readonly GPS_NEAR_M = 50;
  /** ไกลเกินนี้ถือว่าน่าสงสัย — บ้านในหมู่บ้านห่างกันแค่ 8-20 ม. */
  static readonly GPS_FAR_M = 150;

  constructor(
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    private readonly meterReadingsService: MeterReadingsService,
    private readonly billsService: BillsService,
    private readonly photoMetadataService: PhotoMetadataService,
  ) {}

  async analyze(files: Express.Multer.File[], dto: ScanBatchDto) {
    if (!files?.length) {
      throw new BadRequestException('กรุณาแนบรูปมิเตอร์อย่างน้อย 1 รูปครับ');
    }
    if (files.length > ScanBatchService.MAX_FILES) {
      throw new BadRequestException(
        `อัปได้ครั้งละไม่เกิน ${ScanBatchService.MAX_FILES} รูปครับ (ส่งมา ${files.length} รูป)`,
      );
    }

    const members = await this.memberRepository.find({
      where: dto.villages_id ? { villages_id: dto.villages_id } : {},
      order: { house_no: 'ASC' },
    });
    if (members.length === 0) {
      throw new BadRequestException(
        'ยังไม่มีข้อมูลบ้านในระบบ กรุณาเพิ่มลูกบ้านก่อนครับ',
      );
    }

    const memberIds = members.map((m) => m.id);

    // previousUnitsForMembers ตรวจเดือน/ปีให้ด้วย และใช้กฎเลขตั้งต้นชุดเดียวกับตอนออกบิลจริง
    const baseline = await this.billsService.previousUnitsForMembers(
      memberIds,
      dto.billing_month,
      dto.billing_year,
    );

    // พิกัดที่เรียนรู้จากจุดที่เคยไปยืนถ่ายจริง — แม่นกว่าหมุดในทะเบียนมาก
    const learned = this.billsService.learnedMeterLocations(
      await this.billsService.readingsOfMembers(memberIds),
    );

    // OCR ทีละใบตามลำดับ ไม่ยิงขนานเพราะ vision service โหลดโมเดลตัวเดียว
    // ยิงพร้อมกัน 30 ใบมีแต่จะแย่ง GPU/CPU กันเองแล้วช้ากว่าเดิม
    const results: ScanBatchItem[] = [];
    for (const [index, file] of files.entries()) {
      results.push(
        await this.analyzeOne(file, index, members, baseline, learned, dto),
      );
    }

    const counted = (level: MatchConfidence) =>
      results.filter((r) => r.confidence === level).length;

    return {
      billing_month: dto.billing_month,
      billing_year: dto.billing_year,
      total: results.length,
      summary: {
        high: counted('high'),
        medium: counted('medium'),
        ambiguous: counted('ambiguous'),
        none: counted('none'),
      },
      results,
    };
  }

  /** อ่านรูปหนึ่งใบแล้วจัดอันดับว่าน่าจะเป็นของบ้านไหน */
  private async analyzeOne(
    file: Express.Multer.File,
    index: number,
    members: MemberEntity[],
    baseline: Awaited<ReturnType<BillsService['previousUnitsForMembers']>>,
    learned: ReturnType<BillsService['learnedMeterLocations']>,
    dto: ScanBatchDto,
  ): Promise<ScanBatchItem> {
    // อ่าน EXIF จาก buffer ต้นฉบับก่อนใคร — ต้องมาก่อน OCR ด้วย
    // เพราะถ้า vision service ล่ม อย่างน้อยวันเวลาและพิกัดยังได้ติดมือกลับไป
    const photo_taken = this.photoMetadataService.read(file.buffer);
    const warnings = this.checkCaptureDate(photo_taken, dto);

    // vision service ล่มไม่ควรทำให้ทั้งชุด 30 รูปพังตามไปด้วย
    // ใบที่อ่านไม่ได้ให้ตกไปเป็น 'none' แล้วเดินหน้าใบถัดไปต่อ
    let reading: Awaited<
      ReturnType<MeterReadingsService['extractMeterUnit']>
    > | null = null;
    let readError: string | null = null;
    try {
      reading = await this.meterReadingsService.extractMeterUnit(file.buffer);
    } catch (error) {
      readError = (error as { message?: string }).message ?? 'อ่านรูปไม่สำเร็จ';
      this.logger.warn(`รูปที่ ${index + 1} อ่านไม่ได้: ${readError}`);
    }

    // ใช้ integer_part ไม่ใช่ read_unit — read_unit รวมเลขทศนิยม (เข็มแดง) มาด้วย
    // ทำให้ตัวเลขใหญ่เกินจริงหลายเท่า เอามาเทียบกับเลขตั้งต้นในฐานข้อมูลไม่ได้
    const meterUnit = reading?.success
      ? Number(reading.integer_part ?? reading.read_unit)
      : NaN;

    if (!Number.isFinite(meterUnit)) {
      return {
        index,
        filename: file.originalname,
        reading: { success: false, meter_unit: null, confidence: 0 },
        photo_taken,
        confidence: 'none',
        reason:
          readError ??
          reading?.message ??
          'อ่านเลขมิเตอร์จากรูปนี้ไม่ได้ กรุณาเลือกบ้านเอง',
        warnings,
        suggestion: null,
        candidates: [],
      };
    }

    const candidates = this.rankCandidates(
      meterUnit,
      members,
      baseline,
      learned,
      photo_taken,
    );
    const { confidence, reason } = this.judge(
      meterUnit,
      candidates,
      photo_taken,
    );

    const suggestion =
      confidence === 'ambiguous' ? null : (candidates[0] ?? null);
    if (
      suggestion?.distance_m != null &&
      suggestion.distance_m > ScanBatchService.GPS_FAR_M
    ) {
      warnings.push(
        `จุดที่ถ่ายรูปห่างจากพิกัดบ้าน ${suggestion.house_no} ประมาณ ${Math.round(suggestion.distance_m).toLocaleString('th-TH')} เมตร กรุณาตรวจสอบว่าใช่บ้านหลังนี้จริง`,
      );
    }

    return {
      index,
      filename: file.originalname,
      reading: {
        success: true,
        meter_unit: meterUnit,
        confidence: reading?.confidence ?? 0,
        // เก็บเลขดิบไว้ให้คนตรวจย้อนได้ว่าโมเดลเห็นทศนิยมด้วยไหม
        full_reading: reading?.full_reading ?? null,
      },
      photo_taken,
      confidence,
      reason,
      warnings,
      suggestion,
      // ส่งไม่เกิน 5 อันดับพอ หน้าเว็บเอาไปทำ dropdown ให้คนเลือกเอง
      candidates: candidates.slice(0, 5),
    };
  }

  /**
   * วันที่ถ่ายรูปควรตกอยู่ในเดือนที่กำลังออกบิล
   *
   * เตือนอย่างเดียว ไม่บล็อก — นาฬิกากล้องตั้งผิดเป็นเรื่องที่เจอบ่อย
   * และ EXIF ไม่มี timezone ติดมาด้วย จะเอามาตัดสินขาดไม่ได้
   * ด่านที่บล็อกจริงคือ reading_date ตอนออกบิล (parseReadingDate)
   */
  private checkCaptureDate(photo: PhotoMetadata, dto: ScanBatchDto): string[] {
    if (!photo.captured_at) return [];

    const warnings: string[] = [];
    const taken = photo.captured_at;

    if (taken.getTime() > Date.now()) {
      warnings.push(
        `วันเวลาในรูปเป็นอนาคต (${taken.toLocaleString('th-TH')}) นาฬิกาในกล้องอาจตั้งผิด`,
      );
      return warnings;
    }

    const month = Number(dto.billing_month);
    const year = Number(dto.billing_year);
    const takenKey = taken.getFullYear() * 100 + (taken.getMonth() + 1);
    if (takenKey !== year * 100 + month) {
      warnings.push(
        `รูปนี้ถ่ายเมื่อ ${taken.toLocaleDateString('th-TH')} ซึ่งไม่ใช่เดือนที่กำลังออกบิล (${dto.billing_month}/${dto.billing_year})`,
      );
    }

    return warnings;
  }

  /**
   * ให้คะแนนทุกบ้านแล้วเรียงจากเข้าเค้าที่สุด
   *
   * บ้านที่ทำให้หน่วยน้ำติดลบถูกตัดทิ้งทันที (มิเตอร์เดินถอยหลังไม่ได้)
   * ที่เหลือให้คะแนนตามว่าหน่วยที่ใช้ใกล้เคียงกับที่บ้านนั้นเคยใช้แค่ไหน
   */
  private rankCandidates(
    meterUnit: number,
    members: MemberEntity[],
    baseline: Awaited<ReturnType<BillsService['previousUnitsForMembers']>>,
    learned: ReturnType<BillsService['learnedMeterLocations']>,
    photo: PhotoMetadata,
  ): Candidate[] {
    const candidates: Candidate[] = [];

    for (const member of members) {
      const base = baseline.get(member.id);
      if (!base) continue;

      const usage_unit = meterUnit - base.previous_unit;
      if (usage_unit < 0) continue; // เป็นไปไม่ได้ ตัดทิ้ง

      const history = base.usage_history;
      const average_usage =
        history.length > 0
          ? history.reduce((sum, u) => sum + u, 0) / history.length
          : null;

      const score = this.scoreUsage(usage_unit, average_usage);
      if (score <= 0) continue; // เกินเพดานจนไม่สมเหตุสมผล

      candidates.push({
        members_id: member.id,
        house_no: member.house_no,
        name: `${member.fname ?? ''} ${member.lname ?? ''}`.trim(),
        previous_unit: base.previous_unit,
        usage_unit,
        average_usage:
          average_usage === null ? null : Math.round(average_usage * 10) / 10,
        already_billed: base.already_billed,
        score: Math.round(score * 1000) / 1000,
        distance_m: this.distanceTo(photo, member, learned.get(member.id)),
      });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * ระยะจากจุดถ่ายรูปถึงมิเตอร์ของบ้านหลังนี้ — null ถ้าฝั่งใดฝั่งหนึ่งไม่มีพิกัด
   *
   * ═══ ลำดับความน่าเชื่อถือของ "พิกัดบ้าน" ═══
   *
   * 1. พิกัดที่เรียนรู้จากการจดจริง (มัธยฐานของหลายเดือน) — ดีที่สุด
   *    ทั้งจุดอ้างอิงและจุดที่วัดมาจากการยืนที่มิเตอร์เหมือนกัน
   *    ความคลาดเคลื่อนแบบคงที่จึงหักล้างกันเอง
   *
   * 2. members.latitude/longitude ในทะเบียน — ใช้เมื่อยังไม่มีประวัติพอ
   *    มักมาจากการจิ้มหมุดบนแผนที่ (กลางหลังคา) ขณะที่มิเตอร์อยู่ริมรั้ว
   *    จึงมีระยะเหลื่อมติดอยู่ 10-15 ม. ทุกครั้ง ซึ่งพอ ๆ กับระยะห่างระหว่างบ้าน
   *
   * latitude/longitude เป็น decimal ที่ TypeORM คืนมาเป็น string ต้องแปลงก่อนเสมอ
   * ไม่งั้นการลบพิกัดจะกลายเป็น NaN เงียบ ๆ
   */
  private distanceTo(
    photo: PhotoMetadata,
    member: MemberEntity,
    learned?: { latitude: number; longitude: number },
  ): number | null {
    if (photo.latitude === null || photo.longitude === null) return null;

    const latitude = Number(learned?.latitude ?? member.latitude);
    const longitude = Number(learned?.longitude ?? member.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude === 0 && longitude === 0) return null;

    return PhotoMetadataService.distanceMeters(
      { latitude: photo.latitude, longitude: photo.longitude },
      { latitude, longitude },
    );
  }

  /**
   * หน่วยน้ำที่คำนวณได้ "เข้าเค้า" แค่ไหน — คืน 0 ถ้าไม่เข้าเค้าเลย
   *
   * เกณฑ์ตัดใช้ค่าเดียวกับ assertUsageLooksSane ของ BillsService เป๊ะ ๆ
   * ไม่งั้นหน้านี้จะเสนอบ้านที่พอกดยืนยันจริงแล้วโดนตีกลับเป็น 409
   */
  private scoreUsage(usage_unit: number, average_usage: number | null): number {
    if (average_usage === null) {
      // บ้านใหม่ยังไม่มีประวัติ — ตัดสินได้แค่ว่าไม่เกินเพดานตายตัว
      // ให้คะแนนต่ำไว้ตลอด เพราะไม่มีอะไรยืนยันว่าเป็นบ้านนี้จริง
      if (usage_unit > BillsService.USAGE_HARD_CAP) return 0;
      return 0.25;
    }

    const spikeLimit = Math.max(
      average_usage * BillsService.USAGE_SPIKE_RATIO,
      BillsService.USAGE_SPIKE_FLOOR,
    );
    if (usage_unit > spikeLimit) return 0;

    // ยิ่งใกล้ค่าเฉลี่ยยิ่งได้คะแนนสูง — ห่างเท่าค่าเฉลี่ยพอดีได้ 0.5
    const distance = Math.abs(usage_unit - average_usage);
    return 1 / (1 + distance / Math.max(average_usage, 1));
  }

  /** ตัดสินว่ามั่นใจแค่ไหน พร้อมเหตุผลภาษาไทยให้คนอ่านเข้าใจ */
  private judge(
    meterUnit: number,
    candidates: Candidate[],
    photo: PhotoMetadata,
  ): { confidence: MatchConfidence; reason: string } {
    if (candidates.length === 0) {
      return {
        confidence: 'none',
        reason: `เลข ${meterUnit.toLocaleString('th-TH')} ไม่เข้ากับบ้านหลังไหนเลย — ต่ำกว่าเลขตั้งต้นของทุกบ้าน หรือคิดแล้วได้หน่วยน้ำสูงผิดปกติทั้งหมด กรุณาเลือกบ้านเองครับ`,
      };
    }

    const [top, second] = candidates;
    const clearlyAhead = !second || top.score >= second.score * 2;

    if (!clearlyAhead) {
      // เลขมิเตอร์แยกไม่ออก — ลองใช้พิกัดช่วยตัด
      // ให้ได้แค่ medium เท่านั้น เพราะ GPS แยกบ้านที่ห่างกัน 8-20 เมตรไม่ได้จริง
      // ใช้ได้แค่ตอนที่ "ใกล้ชัด ๆ กับหลังหนึ่ง และไกลชัด ๆ จากอีกหลัง"
      const nearest = this.gpsTiebreak(top, second);
      if (nearest) {
        return {
          confidence: 'medium',
          reason: `เลขมิเตอร์เข้าได้ทั้งบ้าน ${top.house_no} และบ้าน ${second.house_no} แต่จุดที่ถ่ายรูปอยู่ห่างบ้าน ${nearest.house_no} เพียง ${Math.round(nearest.distance_m!).toLocaleString('th-TH')} เมตร จึงน่าจะเป็นหลังนี้ กรุณาตรวจสอบก่อนยืนยันครับ`,
        };
      }

      return {
        confidence: 'ambiguous',
        reason:
          `เข้าได้ทั้งบ้าน ${top.house_no} (ใช้ ${top.usage_unit} หน่วย) และบ้าน ${second.house_no} (ใช้ ${second.usage_unit} หน่วย) แยกจากเลขมิเตอร์อย่างเดียวไม่ได้ กรุณาเลือกเองครับ` +
          (photo.latitude === null
            ? ' (รูปนี้ไม่มีพิกัดติดมาด้วย จึงใช้ตำแหน่งช่วยตัดไม่ได้)'
            : ''),
      };
    }

    if (top.score >= 0.4) {
      return {
        confidence: 'high',
        reason: `บ้าน ${top.house_no} ใช้ไป ${top.usage_unit} หน่วย ใกล้เคียงกับที่เคยใช้ (เฉลี่ย ${top.average_usage} หน่วย)`,
      };
    }

    return {
      confidence: 'medium',
      reason:
        top.average_usage === null
          ? `น่าจะเป็นบ้าน ${top.house_no} แต่บ้านหลังนี้ยังไม่มีประวัติให้เทียบ กรุณาตรวจสอบก่อนยืนยันครับ`
          : `น่าจะเป็นบ้าน ${top.house_no} แต่ใช้ไป ${top.usage_unit} หน่วย ต่างจากที่เคยใช้ (เฉลี่ย ${top.average_usage} หน่วย) พอสมควร`,
    };
  }

  /**
   * ใช้พิกัดตัดสินระหว่างสองบ้านที่เลขมิเตอร์แยกไม่ออก
   *
   * ยอมตัดสินเฉพาะตอนที่ผลต่างชัดจริง — หลังหนึ่งอยู่ในระยะ 50 ม.
   * ขณะที่อีกหลังไกลเกิน 150 ม. ถ้าทั้งคู่อยู่ในระยะใกล้พอ ๆ กัน (ซึ่งเป็นเรื่องปกติ
   * เพราะบ้านในหมู่บ้านห่างกันแค่ 8-20 ม.) ต้องคืน null ให้คนเลือกเอง
   * ไม่งั้นจะกลายเป็นการเดาที่ดูน่าเชื่อถือทั้งที่ไม่มีข้อมูลพอ
   */
  private gpsTiebreak(a: Candidate, b: Candidate): Candidate | null {
    if (a.distance_m === null || b.distance_m === null) return null;

    const [near, far] =
      a.distance_m <= b.distance_m ? [a, b] : ([b, a] as const);

    if (
      near.distance_m! <= ScanBatchService.GPS_NEAR_M &&
      far.distance_m! > ScanBatchService.GPS_FAR_M
    ) {
      return near;
    }
    return null;
  }
}
