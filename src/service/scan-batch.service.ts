import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MemberEntity } from '../entity/member.entity';
import { VillageEntity } from '../entity/village.entity';
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
  /**
   * หน่วยที่บ้านหลังนี้ใช้ตามปกติ — median ของ 6 เดือนล่าสุด (null = ยังไม่มีประวัติ)
   * คิดด้วย BillsService.usageBaseline() ตัวเดียวกับด่านตอนออกบิล
   */
  typical_usage: number | null;
  /**
   * @deprecated ชื่อเดิมของ typical_usage — ค่าเท่ากันเป๊ะ เก็บไว้ให้หน้าเว็บรุ่นเก่าไม่พัง
   * เคยเป็นค่าเฉลี่ยของบิลทุกใบจริง ๆ แต่เปลี่ยนเป็น median 6 เดือนแล้ว (ดู usageBaseline)
   */
  average_usage: number | null;
  already_billed: boolean;
  /** 0-1 ยิ่งสูงยิ่งเข้าเค้า */
  score: number;
  /**
   * ระยะจากจุดที่ถ่ายรูปถึงพิกัดบ้านหลังนี้ (เมตร)
   * null = รูปไม่มีพิกัด หรือบ้านหลังนี้ยังไม่ได้กรอกพิกัดไว้
   */
  distance_m: number | null;
  /**
   * การกระจายของพิกัดที่เคยไปจดบ้านหลังนี้ (MAD เป็นเมตร)
   * null = ยังมีประวัติไม่พอ (< 3 ครั้ง) ให้ใช้รัศมีค่ากลางแทน
   */
  spread_m: number | null;
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
    /**
     * จำนวนหลักที่โมเดลเห็นบนหน้าปัด
     * หน้าเว็บต้องส่งค่านี้ต่อไปกับ POST /bills/scan ไม่งั้นด่านจำนวนหลักจะไม่ทำงาน
     */
    meter_digits?: number | null;
  };
  /** วันเวลา + พิกัดที่อ่านได้จาก EXIF ของไฟล์รูป */
  photo_taken: PhotoMetadata;
  confidence: MatchConfidence;
  reason: string;
  /** คำเตือนที่ไม่ถึงขั้นบล็อก เช่น วันถ่ายไม่ตรงเดือนบิล หรือถ่ายไกลจากบ้าน */
  warnings: string[];
  /**
   * index ของรูปใบอื่นในชุดเดียวกันที่ระบบเสนอให้บ้านหลังเดียวกัน
   *
   * ไม่ว่างเมื่อไหร่แปลว่าชุดนี้มีรูปชี้ซ้ำบ้าน และทุกใบในกลุ่มถูกลดเป็น ambiguous แล้ว
   * (เป็น index ชุดเดียวกับ field `index` คือเริ่มที่ 0 ส่วนข้อความใน reason นับจาก 1
   * ให้ตรงกับลำดับที่คนเห็นบนจอ)
   */
  conflicts_with: number[];
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
 * GPS ทำแบบนี้ไม่ได้ เพราะมิเตอร์ห่างกัน 4-20 เมตร (ทาวน์โฮม 4-8, บ้านเดี่ยว 5-20)
 * ขณะที่ GPS มือถือคลาดเคลื่อน 10-30 เมตรเป็นปกติ รัศมีที่กว้างพอจะไม่ปฏิเสธ
 * คนถ่ายถูกบ้าน ย่อมครอบบ้านข้างเคียงไปด้วยเสมอ
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
   *
   * ค่านี้เป็นคำถามเรื่อง "ความแม่นของ GPS" ไม่ใช่ "ความหนาแน่นของหมู่บ้าน"
   * จึงคงที่ทั้งระบบ ไม่ผูกกับ meter_pitch_m: จุดอ้างอิงตอนลงทะเบียนคลาดได้ 20 ม.
   * (MemberService.MAX_ACCEPTABLE_ACCURACY_M) ตอนถ่ายจริงคลาดได้อีก ~30 ม.
   * รวมกันเป็น √(20² + 30²) ≈ 36 ม. — ตั้ง 50 ไว้เผื่อขอบบนพอดี
   * ถ้าหดตามหมู่บ้านหนาแน่น จะกลายเป็นปฏิเสธคนที่ถ่ายถูกบ้านแทน
   */
  static readonly GPS_NEAR_M = 50;

  /**
   * ระยะเดินเฉลี่ยต่อ 1 มิเตอร์ ที่ใช้เมื่อหมู่บ้านยังไม่ได้กรอก `meter_pitch_m`
   * 15 ม. คือค่าขอบบนของหมู่บ้านชนบท — เลือกค่านี้เพราะคูณแล้วได้ 150 ม.
   * ซึ่งเท่ากับค่าคงที่เดิมพอดี หมู่บ้านที่ยังไม่กรอกจึงไม่มีพฤติกรรมเปลี่ยน
   */
  static readonly DEFAULT_METER_PITCH_M = 15;

  /**
   * ไกลเกิน `pitch × ตัวคูณนี้` ถือว่าน่าสงสัย
   *
   * ═══ ทำไมต้องผูกกับความหนาแน่น ไม่ใช่ค่าคงที่ ═══
   *
   * รัศมี R ครอบบ้านราว `2 × (2R / pitch)` หลัง (บ้านเรียงสองฝั่งถนน) ค่าคงที่ 150 ม.
   * จึงให้ผลต่างกันคนละเรื่องระหว่างหมู่บ้านสองแบบ ในหมู่บ้าน 150 หลังคาเรือน:
   *
   *   - ชนบท pitch 15 ม. → ~40 หลัง (27% ของหมู่บ้าน) เป็นด่านที่ตัดได้จริง
   *   - ทาวน์โฮม pitch 6 ม. → ~100 หลัง (67%) แทบไม่ได้ตัดอะไรทิ้งเลย
   *
   * ตัวคูณ 10 = "ห่างเกินสิบหลังคาเรือน" ซึ่งเป็นระยะที่คนเดินจดพลาดไปไกลจริง ๆ
   * ไม่ใช่แค่ GPS เพี้ยน — อ่านแล้วเข้าใจได้โดยไม่ต้องรู้ค่ารัศมีเป็นเมตร
   */
  static readonly GPS_FAR_PITCH_MULTIPLIER = 10;

  /**
   * ขอบล่างของรัศมี "ไกลจนน่าสงสัย" — ต้องห่างจาก GPS_NEAR_M พอสมควร
   * ไม่งั้น gpsTiebreak จะตัดสินจากช่องว่างที่แคบกว่าความคลาดเคลื่อนของ GPS เอง
   * (ตึกแถว pitch 4 ม. คูณ 10 ได้ 40 ม. ซึ่งต่ำกว่า GPS_NEAR_M ด้วยซ้ำ)
   */
  static readonly GPS_FAR_MIN_M = 80;
  /** ขอบบน = ค่าคงที่เดิม กันไม่ให้บ้านสวนที่ pitch สูงกลายเป็นไม่เตือนอะไรเลย */
  static readonly GPS_FAR_MAX_M = 150;

  /** รัศมี "ไกลจนน่าสงสัย" ของหมู่บ้านหนึ่ง — pitch เป็น null ได้ (ยังไม่ได้กรอก) */
  static farThresholdFor(pitch: number | null | undefined): number {
    const effective =
      pitch && pitch > 0 ? pitch : ScanBatchService.DEFAULT_METER_PITCH_M;
    return Math.min(
      ScanBatchService.GPS_FAR_MAX_M,
      Math.max(
        ScanBatchService.GPS_FAR_MIN_M,
        effective * ScanBatchService.GPS_FAR_PITCH_MULTIPLIER,
      ),
    );
  }

  /**
   * ตัวคูณลดคะแนนของบ้านที่มีบิลเดือนนี้ไปแล้ว
   *
   * ไม่ตัดทิ้งเลย เพราะการจดทับของเดิมเป็นสิ่งที่ทำได้จริง (จดผิดแล้วมาแก้)
   * แต่ต้องไม่ชนะบ้านที่ยังไม่มีบิลซึ่งคะแนนพอ ๆ กัน ไม่งั้นรูปของบ้านที่ยังไม่ได้
   * ออกบิลจะถูกเสนอให้ไปทับใบของบ้านข้าง ๆ ที่ออกไปแล้ว
   *
   * 0.3 เลือกให้สัมพันธ์กับเกณฑ์ใน judge() — บ้านที่ออกบิลแล้วต้องมีคะแนนดิบ
   * มากกว่าคู่แข่งราว 6 เท่าถึงจะยังนำอยู่หลังโดนลด (judge ใช้ "นำเกิน 2 เท่า")
   */
  static readonly ALREADY_BILLED_PENALTY = 0.3;

  /**
   * เกณฑ์ "ถ่ายรัวจากจุดเดิม" — ต้องเข้าทั้งสองข้อพร้อมกัน
   *
   * ใช้ค่าเดียวกับ BillsService ที่เป็นด่านบล็อกจริงตอนกดยืนยัน ไม่งั้นหน้านี้จะ
   * ปล่อยผ่านสิ่งที่ปลายทางบล็อก (หรือเตือนสิ่งที่ปลายทางไม่สนใจ) ซึ่งทำให้
   * คำเตือนเชื่อถือไม่ได้ทั้งหน้า
   */
  static readonly BURST_WINDOW_MS = BillsService.BURST_WINDOW_MS;
  static readonly BURST_MOVE_M = BillsService.BURST_MOVE_M;

  constructor(
    @InjectRepository(MemberEntity)
    private readonly memberRepository: Repository<MemberEntity>,
    @InjectRepository(VillageEntity)
    private readonly villageRepository: Repository<VillageEntity>,
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

    // รัศมี "ไกลจนน่าสงสัย" ขึ้นกับความหนาแน่นของหมู่บ้านที่กำลังสแกน
    // ไม่ระบุหมู่บ้านมา = ชุดนี้อาจคละหลายหมู่บ้าน ใช้ค่ากลาง (= รัศมีกว้างสุด)
    // เพราะรัศมีที่แคบเกินจริงจะทำให้ gpsTiebreak กล้าตัดสินแทนคนบ่อยขึ้น
    const farM = ScanBatchService.farThresholdFor(
      dto.villages_id
        ? ((
            await this.villageRepository.findOne({
              where: { id: dto.villages_id },
            })
          )?.meter_pitch_m ?? null)
        : null,
    );

    // previousUnitsForMembers ตรวจเดือน/ปีให้ด้วย และใช้กฎเลขตั้งต้นชุดเดียวกับตอนออกบิลจริง
    const baseline = await this.billsService.previousUnitsForMembers(
      memberIds,
      dto.billing_month,
      dto.billing_year,
    );

    // โหลดการจดทั้งหมดครั้งเดียว ใช้ทั้งเรียนรู้พิกัดและหาจำนวนหลักอ้างอิง
    const readings = await this.billsService.readingsOfMembers(memberIds);
    // พิกัดที่เรียนรู้จากจุดที่เคยไปยืนถ่ายจริง — แม่นกว่าหมุดในทะเบียนมาก
    const learned = this.billsService.learnedMeterLocations(readings);
    // จำนวนหลักบนหน้าปัดของแต่ละบ้าน — ใช้เตือนเมื่อ OCR อ่านหลักหาย/เกิน
    const knownDigits = this.billsService.knownMeterDigits(readings);

    // เวลากดชัตเตอร์ของทุกรูปที่เคยใช้ออกบิลไปแล้ว — ใช้จับรูปเดิมที่ถูกอัปซ้ำ
    // เก็บเป็น epoch ms เพราะ Date คนละ instance เทียบด้วย Set ตรง ๆ ไม่ได้
    const usedCaptureTimes = new Set(
      readings
        .map((r) => (r.captured_at ? new Date(r.captured_at).getTime() : null))
        .filter((t): t is number => t !== null),
    );

    // OCR ทีละใบตามลำดับ ไม่ยิงขนานเพราะ vision service โหลดโมเดลตัวเดียว
    // ยิงพร้อมกัน 30 ใบมีแต่จะแย่ง GPU/CPU กันเองแล้วช้ากว่าเดิม
    const results: ScanBatchItem[] = [];
    for (const [index, file] of files.entries()) {
      results.push(
        await this.analyzeOne(
          file,
          index,
          members,
          baseline,
          learned,
          knownDigits,
          usedCaptureTimes,
          dto,
          farM,
        ),
      );
    }

    // ต้องทำหลังครบทุกใบ — เป็นข้อสรุปที่มองใบเดียวแล้วเห็นไม่ได้
    this.flagBurstPhotos(results);
    this.flagDuplicateSuggestions(results);

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
        /** จำนวนใบที่ถูกลดชั้นเพราะไปชี้บ้านซ้ำกับใบอื่น */
        conflicts: results.filter((r) => r.conflicts_with.length > 0).length,
      },
      results,
    };
  }

  /**
   * รูปหลายใบในชุดเดียวกันที่ชี้ไปบ้านหลังเดียวกัน = อย่างน้อยหนึ่งใบต้องผิด
   *
   * ═══ ทำไมต้องตรวจข้ามใบ ═══
   *
   * analyzeOne() มองทีละใบ จึงไม่มีทางรู้ว่าใบอื่นเสนอบ้านอะไรไปแล้ว ผลคือรูป 5 ใบ
   * ที่เลขมิเตอร์ใกล้กันจะถูกเสนอให้บ้านหลังเดียวกันทั้งหมดอย่างมั่นใจ (high ทุกใบ)
   * โดยระบบไม่รู้ตัว แล้วไปแตกตอนกดยืนยันทีละใบ — ใบแรกออกบิลผ่าน ที่เหลือโดน 409
   * บิลซ้ำทีละใบ เสียเวลาคนกด 5 รอบกว่าจะรู้ว่าการจับคู่ผิดตั้งแต่ต้น
   * และถ้าเผลอกด "จดทับ" ไปเรื่อย ๆ จะเหลือบิลใบเดียว ส่วนอีก 4 บ้านไม่มีบิล
   *
   * ═══ ทำไมลดทุกใบ ไม่เลือกใบที่คะแนนดีที่สุดไว้ ═══
   *
   * เพราะไม่มีข้อมูลพอจะรู้ว่าใบไหนถูก — คะแนนที่สูงกว่าเล็กน้อยไม่ได้แปลว่าใบนั้น
   * เป็นของบ้านหลังนี้จริง อาจเป็นรูปเดียวกันถ่ายซ้ำ หรือ OCR อ่านผิดทั้งกอง
   * การเลือกใบที่คะแนนสูงสุดไว้คือการเดาที่ดูน่าเชื่อถือ ซึ่งอันตรายกว่าการบอกว่าไม่รู้
   * (แนวเดียวกับ gpsTiebreak ที่ยอมคืน null เมื่อข้อมูลไม่พอ)
   */
  /**
   * รูปหลายใบที่ถ่ายรัวจากจุดเดียวกัน = ยืนที่เดิมกดชัตเตอร์ ไม่ใช่เดินไปถ่ายทีละมิเตอร์
   *
   * ═══ ทำไมด่าน "ไฟล์ซ้ำ" จับไม่ได้ ═══
   *
   * ด่านนั้นเทียบ captured_at ตรงเป๊ะ ซึ่งจับได้เฉพาะไฟล์เดิมที่ถูกอัปซ้ำ แต่การกด
   * ชัตเตอร์รัว 5 ครั้งได้ 5 ไฟล์คนละใบที่เวลาต่างกัน 0.3-0.8 วินาที — ลอดไปทั้งหมด
   *
   * ═══ ทำไมต้องดูทั้งเวลาและระยะ ═══
   *
   * เวลาอย่างเดียว: ทาวน์โฮมที่มิเตอร์ติดกำแพงเดียวกัน ถ่ายห่างกัน 2-3 วินาทีเป็นเรื่องจริง
   * ระยะอย่างเดียว: การกลับไปถ่ายซ้ำที่มิเตอร์เดิมในวันหลังก็อยู่จุดเดิมเหมือนกัน
   * ต้องเข้าทั้งสองเงื่อนไขพร้อมกันถึงจะแปลว่ายืนนิ่งกดรัว
   *
   * ที่นี่แค่ **เตือน** ไม่บล็อก (เหมือนทุกอย่างใน service นี้) ด่านที่บล็อกจริง
   * อยู่ที่ `BillsService.assertPhotoNotReused()` ตอนกดยืนยันออกบิล
   */
  private flagBurstPhotos(results: ScanBatchItem[]): void {
    for (let i = 0; i < results.length; i += 1) {
      const a = results[i];
      if (!a.photo_taken.captured_at) continue;

      for (let j = i + 1; j < results.length; j += 1) {
        const b = results[j];
        if (!b.photo_taken.captured_at) continue;

        const gapMs = Math.abs(
          a.photo_taken.captured_at.getTime() -
            b.photo_taken.captured_at.getTime(),
        );
        if (gapMs > ScanBatchService.BURST_WINDOW_MS) continue;

        // ไม่มีพิกัดทั้งคู่ = ตัดสินไม่ได้ว่ายืนที่เดิมไหม ปล่อยผ่าน
        // (ดีกว่าเตือนมั่ว ๆ จนคนเลิกอ่านคำเตือน)
        if (
          a.photo_taken.latitude === null ||
          a.photo_taken.longitude === null ||
          b.photo_taken.latitude === null ||
          b.photo_taken.longitude === null
        ) {
          continue;
        }

        const moved = PhotoMetadataService.distanceMeters(
          {
            latitude: a.photo_taken.latitude,
            longitude: a.photo_taken.longitude,
          },
          {
            latitude: b.photo_taken.latitude,
            longitude: b.photo_taken.longitude,
          },
        );
        if (moved > ScanBatchService.BURST_MOVE_M) continue;

        const note =
          `รูปที่ ${a.index + 1} กับ ${b.index + 1} ถ่ายห่างกันแค่ ${(gapMs / 1000).toFixed(1)} วินาที ` +
          `และอยู่ห่างกัน ${Math.round(moved)} เมตร — เท่ากับยืนอยู่ที่เดิมกดชัตเตอร์รัว ` +
          `ไม่ใช่การเดินไปถ่ายมิเตอร์คนละหลัง จะออกบิลได้ใบเดียวเท่านั้น`;
        if (!a.warnings.includes(note)) a.warnings.push(note);
        if (!b.warnings.includes(note)) b.warnings.push(note);
      }
    }
  }

  private flagDuplicateSuggestions(results: ScanBatchItem[]): void {
    const byMember = new Map<number, ScanBatchItem[]>();
    for (const item of results) {
      if (!item.suggestion) continue;
      const group = byMember.get(item.suggestion.members_id);
      if (group) group.push(item);
      else byMember.set(item.suggestion.members_id, [item]);
    }

    for (const group of byMember.values()) {
      if (group.length < 2) continue;

      // เก็บชื่อบ้านก่อน เพราะข้างล่างจะล้าง suggestion ทิ้ง
      const house_no = group[0].suggestion!.house_no;
      const photoNumbers = group.map((item) => item.index + 1).join(', ');

      for (const item of group) {
        item.conflicts_with = group
          .filter((other) => other !== item)
          .map((other) => other.index);
        item.confidence = 'ambiguous';
        item.suggestion = null;
        item.reason =
          `รูปที่ ${photoNumbers} ถูกเสนอให้บ้าน ${house_no} เหมือนกันทั้งหมด ` +
          `แต่ 1 บ้านมีบิลได้เดือนละใบเดียว จึงมีอย่างน้อยหนึ่งใบที่จับคู่ผิด — ` +
          `กรุณาเลือกว่าใบไหนคือบ้าน ${house_no} ส่วนใบที่เหลือให้เลือกบ้านเองหรือถ่ายใหม่ครับ`;
      }
    }
  }

  /** อ่านรูปหนึ่งใบแล้วจัดอันดับว่าน่าจะเป็นของบ้านไหน */
  private async analyzeOne(
    file: Express.Multer.File,
    index: number,
    members: MemberEntity[],
    baseline: Awaited<ReturnType<BillsService['previousUnitsForMembers']>>,
    learned: ReturnType<BillsService['learnedMeterLocations']>,
    knownDigits: ReturnType<BillsService['knownMeterDigits']>,
    /** epoch ms ของ captured_at ทุกรูปที่เคยใช้ออกบิลไปแล้ว */
    usedCaptureTimes: Set<number>,
    dto: ScanBatchDto,
    /** รัศมี "ไกลจนน่าสงสัย" ของหมู่บ้านที่กำลังสแกน — ดู farThresholdFor() */
    farM: number,
  ): Promise<ScanBatchItem> {
    // อ่าน EXIF จาก buffer ต้นฉบับก่อนใคร — ต้องมาก่อน OCR ด้วย
    // เพราะถ้า vision service ล่ม อย่างน้อยวันเวลาและพิกัดยังได้ติดมือกลับไป
    const photo_taken = this.photoMetadataService.read(file.buffer);
    const warnings = this.checkCaptureDate(photo_taken, dto);

    // รูปใบนี้เคยถูกใช้ออกบิลไปแล้วหรือยัง — เตือนตั้งแต่ตรงนี้ ไม่ต้องรอไปโดน
    // บล็อกตอนกดยืนยัน คนจะได้เห็นตั้งแต่ยังดูรูปทั้งชุดอยู่ว่าใบไหนหยิบผิด
    if (
      photo_taken.captured_at &&
      usedCaptureTimes.has(photo_taken.captured_at.getTime())
    ) {
      warnings.push(
        `รูปนี้ถ่ายเมื่อ ${photo_taken.captured_at.toLocaleString('th-TH')} ซึ่งตรงกับการจดมิเตอร์ที่บันทึกไว้แล้ว — เป็นไฟล์รูปเดิมที่เคยใช้ไปแล้ว จะออกบิลจากรูปนี้ไม่ได้`,
      );
    }

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
        reading: {
          success: false,
          meter_unit: null,
          confidence: 0,
          meter_digits: null,
        },
        photo_taken,
        confidence: 'none',
        reason:
          readError ??
          reading?.message ??
          'อ่านเลขมิเตอร์จากรูปนี้ไม่ได้ กรุณาเลือกบ้านเอง',
        warnings,
        conflicts_with: [],
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
      farM,
    );

    const suggestion =
      confidence === 'ambiguous' ? null : (candidates[0] ?? null);
    if (suggestion?.distance_m != null && suggestion.distance_m > farM) {
      warnings.push(
        `จุดที่ถ่ายรูปห่างจากพิกัดบ้าน ${suggestion.house_no} ประมาณ ${Math.round(suggestion.distance_m).toLocaleString('th-TH')} เมตร กรุณาตรวจสอบว่าใช่บ้านหลังนี้จริง`,
      );
    }

    if (suggestion) {
      // เตือนตั้งแต่ตรงนี้ ไม่ต้องรอให้ไปโดน 409 ตอนกดยืนยัน — คนจะได้ตัดสินใจ
      // ตั้งแต่ยังเห็นรูปทั้งชุดอยู่ ว่าจะจดทับของเดิมหรือรูปใบนี้เป็นของบ้านอื่น
      if (suggestion.already_billed) {
        warnings.push(
          `บ้าน ${suggestion.house_no} ออกบิลเดือน ${dto.billing_month}/${dto.billing_year} ไปแล้ว การยืนยันรูปนี้จะเป็นการจดทับของเดิม`,
        );
      }

      // จำนวนหลักที่ไม่ตรงกับที่บ้านหลังนี้เคยอ่านได้ = สัญญาณว่า OCR อ่านหลักหาย/เกิน
      // ซึ่งจะไปโดนบล็อกที่ BillsService ตอนกดยืนยันอยู่แล้ว บอกล่วงหน้าที่นี่ด้วย
      const digits = reading?.meter_digits ?? null;
      const expected = knownDigits.get(suggestion.members_id);
      if (digits !== null && expected !== undefined && digits !== expected) {
        warnings.push(
          `หน้าปัดของบ้าน ${suggestion.house_no} เคยอ่านได้ ${expected} หลัก แต่รูปนี้อ่านได้ ${digits} หลัก กรุณาเทียบเลขกับรูปอีกครั้งครับ`,
        );
      }
    }

    // OCR อ่านผิดค่าโดยจำนวนหลักไม่เปลี่ยน (1250 → 1258) เป็นเคสที่ด่านอื่นจับไม่ได้เลย
    // ตัวเดียวที่จับได้คือ confidence ของหลักที่อ่อนที่สุด ซึ่ง vision service ส่งมาให้แล้ว
    // ตรงนี้เตือนล่วงหน้า ส่วนด่านที่บล็อกจริงอยู่ที่ BillsService ตอนกดยืนยัน
    const readConfidence = reading?.confidence ?? 0;
    if (
      readConfidence > 0 &&
      readConfidence < BillsService.MIN_READ_CONFIDENCE
    ) {
      warnings.push(
        `ระบบอ่านเลขได้ไม่ชัด (หลักที่ไม่ชัดที่สุดมั่นใจ ${Math.round(readConfidence * 100)}%) กรุณาเทียบเลข ${meterUnit.toLocaleString('th-TH')} กับรูปหน้าปัดทีละหลักก่อนยืนยันครับ`,
      );
    }

    return {
      index,
      filename: file.originalname,
      reading: {
        success: true,
        meter_unit: meterUnit,
        confidence: readConfidence,
        // เก็บเลขดิบไว้ให้คนตรวจย้อนได้ว่าโมเดลเห็นทศนิยมด้วยไหม
        full_reading: reading?.full_reading ?? null,
        meter_digits: reading?.meter_digits ?? null,
      },
      photo_taken,
      confidence,
      reason,
      warnings,
      conflicts_with: [],
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
  /**
   * ผู้สมัครของเลขมิเตอร์หนึ่งค่า โดยไม่ต้องมีไฟล์รูป — ใช้โดยหน้าจับคู่ข้อมูลกำพร้า
   *
   * ═══ ทำไมต้องเปิดทางเข้าตรงนี้ ═══
   *
   * `analyze()` รับ multipart แล้ว OCR เอง ซึ่งเหมาะกับตอนอัปรูปทั้งชุด แต่ข้อมูล
   * กำพร้าถูกอ่านและเก็บลงดิสก์ไปตั้งแต่รอบก่อนแล้ว การส่งไฟล์กลับเข้าไป OCR ใหม่
   * เท่ากับจ่ายค่า GPU ซ้ำเพื่อผลลัพธ์เดิม
   *
   * ที่สำคัญกว่าคือ **ต้องเป็นเกณฑ์ชุดเดียวกัน** — ถ้าหน้าจับคู่เขียนสูตรของตัวเอง
   * มันจะเสนอบ้านที่พอกดยืนยันจริงแล้วโดน BillsService ตีกลับเป็น 409
   */
  async candidatesForUnit(
    meterUnit: number,
    params: {
      billing_month: string;
      billing_year: string;
      villages_id?: number | null;
      latitude?: number | null;
      longitude?: number | null;
    },
  ): Promise<Candidate[]> {
    const members = await this.memberRepository.find({
      where: params.villages_id ? { villages_id: params.villages_id } : {},
      order: { house_no: 'ASC' },
    });
    if (members.length === 0) return [];

    const memberIds = members.map((m) => m.id);
    const baseline = await this.billsService.previousUnitsForMembers(
      memberIds,
      params.billing_month,
      params.billing_year,
    );
    const learned = this.billsService.learnedMeterLocations(
      await this.billsService.readingsOfMembers(memberIds),
    );

    // ประกอบ PhotoMetadata เทียม — ใช้เฉพาะพิกัดในการคิดระยะ ส่วน EXIF ไม่เกี่ยว
    return this.rankCandidates(meterUnit, members, baseline, learned, {
      has_exif: false,
      captured_at: null,
      latitude: params.latitude ?? null,
      longitude: params.longitude ?? null,
    });
  }

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

      // ใช้ค่าที่ BillsService คิดมาให้แล้ว ไม่คำนวณเองซ้ำ — เกณฑ์ของหน้านี้กับ
      // ด่านตอนกดยืนยันต้องเป็นสูตรเดียวกันเป๊ะ ไม่งั้นจะเสนอบ้านที่พอกดจริงแล้วโดน 409
      const typical_usage = base.typical_usage;

      const rawScore = this.scoreUsage(usage_unit, typical_usage);
      if (rawScore <= 0) continue; // เกินเพดานจนไม่สมเหตุสมผล

      // บ้านที่ออกบิลเดือนนี้ไปแล้วยังเป็นตัวเลือกได้ (จดผิดแล้วมาแก้เป็นเรื่องปกติ)
      // แต่ต้องไม่ชนะบ้านที่ยังไม่มีบิลซึ่งคะแนนพอ ๆ กัน
      const score = base.already_billed
        ? rawScore * ScanBatchService.ALREADY_BILLED_PENALTY
        : rawScore;

      candidates.push({
        members_id: member.id,
        house_no: member.house_no,
        name: `${member.fname ?? ''} ${member.lname ?? ''}`.trim(),
        previous_unit: base.previous_unit,
        usage_unit,
        typical_usage:
          typical_usage === null ? null : Math.round(typical_usage * 10) / 10,
        average_usage:
          typical_usage === null ? null : Math.round(typical_usage * 10) / 10,
        already_billed: base.already_billed,
        score: Math.round(score * 1000) / 1000,
        distance_m: this.distanceTo(photo, member, learned.get(member.id)),
        spread_m: learned.get(member.id)?.spread_m ?? null,
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
  private scoreUsage(usage_unit: number, typical_usage: number | null): number {
    if (typical_usage === null) {
      // บ้านใหม่ยังไม่มีประวัติ — ตัดสินได้แค่ว่าไม่เกินเพดานตายตัว
      // ให้คะแนนต่ำไว้ตลอด เพราะไม่มีอะไรยืนยันว่าเป็นบ้านนี้จริง
      if (usage_unit > BillsService.USAGE_HARD_CAP) return 0;
      return 0.25;
    }

    const spikeLimit = Math.max(
      typical_usage * BillsService.USAGE_SPIKE_RATIO,
      BillsService.USAGE_SPIKE_FLOOR,
    );
    if (usage_unit > spikeLimit) return 0;

    // ยิ่งใกล้ค่าปกติยิ่งได้คะแนนสูง — ห่างเท่าค่าปกติพอดีได้ 0.5
    const distance = Math.abs(usage_unit - typical_usage);
    return 1 / (1 + distance / Math.max(typical_usage, 1));
  }

  /** ตัดสินว่ามั่นใจแค่ไหน พร้อมเหตุผลภาษาไทยให้คนอ่านเข้าใจ */
  private judge(
    meterUnit: number,
    candidates: Candidate[],
    photo: PhotoMetadata,
    farM: number,
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
      // ให้ได้แค่ medium เท่านั้น เพราะ GPS แยกมิเตอร์ที่ห่างกัน 4-20 เมตรไม่ได้จริง
      // ใช้ได้แค่ตอนที่ "ใกล้ชัด ๆ กับหลังหนึ่ง และไกลชัด ๆ จากอีกหลัง"
      const nearest = this.gpsTiebreak(top, second, farM);
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
   * ความคลาดเคลื่อนรวมของการวัดระยะหนึ่งครั้ง (เมตร)
   *
   * จุดอ้างอิงคลาดได้ 20 ม. (MemberService.MAX_ACCEPTABLE_ACCURACY_M)
   * จุดที่ถ่ายจริงคลาดได้อีก ~30 ม. — ความคลาดเคลื่อนอิสระบวกกันแบบ RSS ไม่ใช่ตรง ๆ
   * √(20² + 30²) ≈ 36 ม.
   *
   * ระยะสองค่าที่ต่างกันน้อยกว่านี้ = แยกไม่ออกจริง ไม่ใช่ "หลังหนึ่งใกล้กว่า"
   */
  static readonly GPS_COMBINED_ERROR_M = 36;

  /**
   * รัศมี "ถ่ายอยู่ที่บ้านหลังนี้จริง" เฉพาะของบ้านหนึ่ง
   *
   * บ้านที่มีประวัติการจดพอจะรู้การกระจายของตัวเอง (spread_m = MAD) ให้ใช้ 2×MAD
   * ซึ่งครอบราว 3 ใน 4 ของครั้งที่เคยไปจริง — แคบกว่าค่ากลางมากสำหรับมิเตอร์
   * กลางทุ่งที่ GPS นิ่ง และไม่ปล่อยให้หลวมเกิน GPS_NEAR_M สำหรับมิเตอร์ใต้ชายคา
   *
   * ขอบล่างที่ GPS_COMBINED_ERROR_M เพราะรัศมีที่แคบกว่าความคลาดเคลื่อนของ
   * การวัดครั้งเดียว จะปฏิเสธคนที่ถ่ายถูกบ้าน ซึ่งแย่กว่าการไม่ตัดสิน
   */
  private nearLimitFor(candidate: Candidate): number {
    if (candidate.spread_m === null) return ScanBatchService.GPS_NEAR_M;
    return Math.min(
      ScanBatchService.GPS_NEAR_M,
      Math.max(ScanBatchService.GPS_COMBINED_ERROR_M, candidate.spread_m * 2),
    );
  }

  /**
   * ใช้พิกัดตัดสินระหว่างสองบ้านที่เลขมิเตอร์แยกไม่ออก
   *
   * ยอมตัดสินก็ต่อเมื่อผ่านครบ **สามข้อ** ซึ่งตอบคนละคำถามกัน:
   *
   *   1. `d₁ ≤ nearLimit(top)` — ใกล้พอจะเป็นบ้านหลังนี้จริง (ดู nearLimitFor)
   *   2. `d₂ > farM`           — อีกหลังไกลเกินความหนาแน่นของหมู่บ้านนี้
   *   3. `d₂ - d₁ > 36 ม.`     — ช่องว่างกว้างกว่าความคลาดเคลื่อนของการวัดเอง
   *
   * ข้อ 3 สำคัญที่สุด: ถ้าไม่มี ระยะ 45 ม. กับ 52 ม. จะถูกตีความว่า "หลังแรกใกล้กว่า"
   * ทั้งที่ต่างกัน 7 ม. ซึ่งน้อยกว่าความคลาดเคลื่อนของการวัดครั้งเดียวหลายเท่า
   * — วัดใหม่อีกรอบอันดับอาจสลับกันเลย
   *
   * ทั้งคู่ใกล้พอ ๆ กัน (เรื่องปกติ เพราะมิเตอร์ห่างกันแค่ 4-20 ม.) ต้องคืน null
   * ให้คนเลือกเอง ไม่งั้นจะกลายเป็นการเดาที่ดูน่าเชื่อถือทั้งที่ข้อมูลไม่พอ
   */
  private gpsTiebreak(
    a: Candidate,
    b: Candidate,
    farM: number,
  ): Candidate | null {
    if (a.distance_m === null || b.distance_m === null) return null;

    const [near, far] =
      a.distance_m <= b.distance_m ? [a, b] : ([b, a] as const);

    if (
      near.distance_m! <= this.nearLimitFor(near) &&
      far.distance_m! > farM &&
      far.distance_m! - near.distance_m! > ScanBatchService.GPS_COMBINED_ERROR_M
    ) {
      return near;
    }
    return null;
  }
}
