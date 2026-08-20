import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { BillsService } from './bills.service';
import { MeterPhotoService } from './meter-photo.service';
import { BillEntity } from '../entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { VillageEntity } from '../entity/village.entity';
import { BillArrearsEntity } from '../entity/bill-arrears.entity';
import { MeterEntity } from '../entity/meter.entity';
import { ReadingFlagsService } from './reading-flags.service';
import { ReadingLogsService } from './reading-logs.service';
import { CreateBillFromScanDto } from '../dto/create-bill-from-scan.dto';

/**
 * เทสต์ด่านตรวจข้อมูลก่อนออกบิล
 *
 * prepareBill() ตรวจเดือน/ปี/วันที่จด **ก่อน** เรียกฐานข้อมูลบรรทัดแรก
 * เคสที่ต้องถูกปฏิเสธจึงไม่แตะ repository เลย mock เปล่า ๆ ก็พอ ไม่ต้องต่อ MySQL
 *
 * ⚠️ ห้ามฮาร์ดโค้ดวันที่ลงในเทสต์ เพราะกฎ "ห้ามเป็นวันอนาคต" กับ
 *    "ปีต้องไม่เกินปีหน้า" อิงวันที่จริงตอนรัน เทสต์ที่ตรึงวันไว้จะพังเองเมื่อเวลาผ่านไป
 */

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TODAY = new Date();
const CURRENT_MONTH = pad(TODAY.getMonth() + 1);
const CURRENT_YEAR = String(TODAY.getFullYear());

/** ข้อความที่ prepareBill โยนออกมาเมื่อ "ผ่านด่านตรวจแล้ว" — ใช้เป็นหมุดว่า validation ปล่อยผ่าน */
const PASSED_VALIDATION = 'ไม่พบข้อมูลเรทค่าน้ำที่ระบุในระบบ';

describe('BillsService — ด่านตรวจก่อนออกบิล', () => {
  let service: BillsService;
  let waterRateRepository: { findOne: jest.Mock };
  let billRepository: {
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let meterReadingRepository: { find: jest.Mock; findOne: jest.Mock };
  let memberRepository: {
    find: jest.Mock;
    findOne: jest.Mock;
    findOneBy: jest.Mock;
  };
  let villageRepository: { findOne: jest.Mock };
  let photoService: { remove: jest.Mock; save: jest.Mock };
  let billArrearsRepository: { find: jest.Mock };
  let meterRepository: { findOne: jest.Mock };
  let readingFlagsService: { record: jest.Mock };
  let readingLogsService: { record: jest.Mock };
  let txManager: Record<string, jest.Mock>;

  beforeEach(() => {
    // คืน null เสมอ = "ไม่พบเรทค่าน้ำ" ใช้เป็นหมุดบอกว่าโค้ดวิ่งผ่านด่านตรวจมาถึงตรงนี้ได้
    waterRateRepository = { findOne: jest.fn().mockResolvedValue(null) };

    // query builder ตัวเดียวใช้ได้ทั้ง findByMemberAndMonth และ billsOfMember
    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    };

    // manager ปลอมตัวเดียวใช้ซ้ำทุกทรานแซกชัน — เก็บไว้ใน txManager ด้วย
    // เพื่อให้เทสต์ตรวจได้ว่ามีการ update อะไรลงตารางไหนบ้าง
    txManager = {
      delete: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_entity: unknown, value: unknown) => value),
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({ id: 99, ...value }),
      ),
      findOne: jest.fn().mockResolvedValue(null),
    };

    billRepository = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => queryBuilder),
      manager: {
        // รันคอลแบ็กจริงด้วย manager ปลอม จะได้เห็นค่าที่คำนวณได้จริง ๆ ในบิลที่คืนออกมา
        transaction: jest.fn((cb: (m: Record<string, jest.Mock>) => unknown) =>
          Promise.resolve(cb(txManager)),
        ),
      },
    };

    meterReadingRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    // บ้านไม่ผูกหมู่บ้าน = resolveDueDate ถอยไปใช้รอบชำระค่ากลาง 15 วัน
    memberRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: 1, villages_id: null }),
      // บ้านเดี่ยว (ไม่มี cluster_group_id) = ด่านที่ใช้ระยะทางทำงานตามเดิมทุกข้อ
      findOneBy: jest.fn().mockResolvedValue({
        id: 1,
        villages_id: null,
        cluster_group_id: null,
      }),
    };
    villageRepository = { findOne: jest.fn().mockResolvedValue(null) };
    photoService = {
      remove: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(),
    };

    // ยอดค้าง: ไม่มีบิลเก่าค้างอยู่ในเทสต์ชุดนี้ การผูก bill_arrears จึงไม่ถูกเรียก
    billArrearsRepository = { find: jest.fn().mockResolvedValue([]) };
    // ทะเบียนมิเตอร์: ไม่มีตัวที่ถอดแล้วรอคิดหน่วยค้าง (คืน null = ไม่มี)
    meterRepository = { findOne: jest.fn().mockResolvedValue(null) };
    // ธง: เก็บไว้ตรวจว่าด่านที่กดผ่านทิ้งร่องรอยไว้จริง
    readingFlagsService = { record: jest.fn().mockResolvedValue(undefined) };
    // log การแก้เลขมิเตอร์: เก็บไว้ตรวจว่าการแก้ทิ้งร่องรอยไว้จริง
    readingLogsService = { record: jest.fn().mockResolvedValue(undefined) };

    service = new BillsService(
      billRepository as unknown as Repository<BillEntity>,
      waterRateRepository as unknown as Repository<WaterRateEntity>,
      meterReadingRepository as unknown as Repository<MeterReadingEntity>,
      memberRepository as unknown as Repository<MemberEntity>,
      villageRepository as unknown as Repository<VillageEntity>,
      photoService as unknown as MeterPhotoService,
      billArrearsRepository as unknown as Repository<BillArrearsEntity>,
      meterRepository as unknown as Repository<MeterEntity>,
      readingFlagsService as unknown as ReadingFlagsService,
      readingLogsService as unknown as ReadingLogsService,
    );
  });

  /**
   * ให้ผ่านด่านเรทค่าน้ำได้ แล้วตั้งเลขมิเตอร์ตั้งต้นของบ้านหลังนี้
   *
   * meterDigits = จำนวนหลักที่บ้านหลังนี้เคยอ่านได้ (ไม่ส่ง = ยังไม่เคยจดผ่าน OCR)
   */
  const givenBaseline = (previousUnit: number, meterDigits?: number) => {
    waterRateRepository.findOne.mockResolvedValue({
      id: 1,
      price_per_unit: '15.00',
    });
    // ไม่มีบิลเก่า → เลขตั้งต้นมาจากการจดตอนลงทะเบียน
    meterReadingRepository.find.mockResolvedValue([
      { id: 1, meter_unit: previousUnit, meter_digits: meterDigits ?? null },
    ]);
  };

  /**
   * dto ตั้งต้นที่ถูกต้องทุกอย่าง แล้วค่อยแก้เฉพาะ field ที่อยากทดสอบ
   *
   * ต้องระบุ entry_method: 'ocr' เพราะกฎ "กรอกมือต้องแนบรูปเสมอ" บล็อกการจด
   * ที่ไม่ได้ผ่าน OCR และไม่มีรูป — ซึ่งไม่ใช่สิ่งที่เทสต์ชุดนี้กำลังทดสอบ
   * (เคสของกฎนั้นอยู่ใน describe 'วิธีกรอกเลขมิเตอร์' ของไฟล์นี้เอง)
   */
  const dto = (overrides: Partial<CreateBillFromScanDto> = {}) => ({
    members_id: 1,
    water_rates_id: 1,
    current_unit: 1250,
    billing_month: CURRENT_MONTH,
    billing_year: CURRENT_YEAR,
    entry_method: 'ocr',
    ...overrides,
  });

  /** ธงที่ถูกส่งเข้า ReadingFlagsService.record() ในการเรียกครั้งแรก */
  const recordedFlags = (): { flag_type: string }[] => {
    const calls = readingFlagsService.record.mock.calls as unknown[][];
    return (calls[0]?.[2] ?? []) as { flag_type: string }[];
  };

  describe('เดือน/ปีของบิล', () => {
    it.each(['13', '0', 'ส.ค.', ''])(
      'ปฏิเสธเดือน "%s" ที่ใช้ไม่ได้',
      async (billing_month) => {
        await expect(
          service.createFromScan(dto({ billing_month })),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('ปฏิเสธปีที่ไกลเกินไป (ปล่อยผ่าน = ด่านเทียบลำดับเดือนจะเพี้ยนทั้งสาย)', async () => {
      const farFuture = String(TODAY.getFullYear() + 5);
      await expect(
        service.createFromScan(dto({ billing_year: farFuture })),
      ).rejects.toThrow(BadRequestException);
    });

    it('ไม่แตะฐานข้อมูลเลยเมื่อเดือนผิด', async () => {
      await expect(
        service.createFromScan(dto({ billing_month: '13' })),
      ).rejects.toThrow(BadRequestException);

      expect(waterRateRepository.findOne).not.toHaveBeenCalled();
      expect(billRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('วันที่จดมิเตอร์', () => {
    it('ปฏิเสธ string ที่ไม่ใช่วันที่ (ของเดิมหลุดไปพังที่ MySQL เป็น 500)', async () => {
      await expect(
        service.createFromScan(dto({ reading_date: 'เมื่อวาน' })),
      ).rejects.toThrow(/ไม่ใช่วันที่ที่อ่านได้/);
    });

    it('ปฏิเสธวันที่ในอนาคต', async () => {
      const tomorrow = new Date(TODAY);
      tomorrow.setDate(tomorrow.getDate() + 1);

      await expect(
        service.createFromScan(dto({ reading_date: toIso(tomorrow) })),
      ).rejects.toThrow(/เป็นวันในอนาคต/);
    });

    it('ปฏิเสธวันที่ที่ห่างจากเดือนบิลเกิน 15 วัน', async () => {
      // ออกบิลย้อนหลัง 6 เดือน แต่บอกว่าจดมิเตอร์วันนี้ — ขัดกันชัดเจน
      const sixMonthsAgo = new Date(
        TODAY.getFullYear(),
        TODAY.getMonth() - 6,
        1,
      );

      await expect(
        service.createFromScan(
          dto({
            billing_month: pad(sixMonthsAgo.getMonth() + 1),
            billing_year: String(sixMonthsAgo.getFullYear()),
            reading_date: toIso(TODAY),
          }),
        ),
      ).rejects.toThrow(/ห่างจากบิลเดือน/);
    });

    it('ยอมรับวันนี้สำหรับบิลเดือนปัจจุบัน', async () => {
      await expect(
        service.createFromScan(dto({ reading_date: toIso(TODAY) })),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.createFromScan(dto({ reading_date: toIso(TODAY) })),
      ).rejects.toThrow(PASSED_VALIDATION);
    });

    it('ยอมรับการจดปลายเดือนก่อนหน้า (อยู่ในระยะผ่อนผัน 15 วัน)', async () => {
      // วันสุดท้ายของเดือนก่อน = new Date(ปีนี้, เดือนนี้, 0)
      const lastDayOfPrevMonth = new Date(
        TODAY.getFullYear(),
        TODAY.getMonth(),
        0,
      );

      await expect(
        service.createFromScan(
          dto({ reading_date: toIso(lastDayOfPrevMonth) }),
        ),
      ).rejects.toThrow(PASSED_VALIDATION);
    });

    it('ไม่ส่ง reading_date มาก็ผ่าน (ใช้วันนี้แทน)', async () => {
      await expect(service.createFromScan(dto())).rejects.toThrow(
        PASSED_VALIDATION,
      );
    });
  });

  // WC-4 — เคสนี้เกิดแน่นอนตามอายุมิเตอร์ ถ้าไม่มีทางออกบ้านนั้นออกบิลไม่ได้ตลอดไป
  describe('เปลี่ยนมิเตอร์ใหม่ / มิเตอร์วนรอบ', () => {
    it('เลขต่ำกว่าเดือนก่อนโดยไม่ยืนยัน → บล็อก พร้อมบอกทางออก', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(dto({ current_unit: 15 })),
      ).rejects.toThrow(/ถ้าเพิ่งเปลี่ยนมิเตอร์ตัวใหม่/);
    });

    it('ยืนยันเปลี่ยนมิเตอร์ → เริ่มนับจาก 0 ออกบิลได้', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan(
        dto({ current_unit: 15, confirm_meter_reset: true }),
      );

      expect(bill.previous_unit).toBe(0);
      expect(bill.usage_unit).toBe(15);
      expect(bill.total_amount).toBe(225); // 15 หน่วย × 15 บาท
    });

    it('กรอกเลขปิดมิเตอร์ตัวเก่ามาด้วย → บวกน้ำที่ใช้ก่อนเปลี่ยนเข้าไปครบ', async () => {
      givenBaseline(1250);

      // ตัวเก่าปิดที่ 1,270 (ใช้ไป 20 หน่วยก่อนถอด) + ตัวใหม่เดินมา 15 หน่วย
      const bill = await service.createFromScan(
        dto({
          current_unit: 15,
          confirm_meter_reset: true,
          old_meter_final_unit: 1270,
        }),
      );

      expect(bill.usage_unit).toBe(35);
    });

    it('เลขปิดมิเตอร์เก่าต่ำกว่าเลขตั้งต้น → บล็อก (กรอกผิดแน่นอน)', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({
            current_unit: 15,
            confirm_meter_reset: true,
            old_meter_final_unit: 1000,
          }),
        ),
      ).rejects.toThrow(/เลขปิดของมิเตอร์ตัวเก่า/);
    });

    it('เลขปกติ (ไม่ต่ำกว่าเดือนก่อน) ยังคิดแบบเดิมทุกอย่าง', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan(dto({ current_unit: 1259 }));

      expect(bill.previous_unit).toBe(1250);
      expect(bill.usage_unit).toBe(9);
    });
  });

  // WC-5 — ทางจดทับกันบิลที่จ่ายแล้วไว้ แต่ทางลบเคยเปิดทิ้ง ทั้งที่ลบแล้วรูปหลักฐานหายด้วย
  describe('ลบบิล', () => {
    it('ลบบิลที่ชำระเงินแล้วไม่ได้', async () => {
      billRepository.findOne.mockResolvedValue({
        id: 7,
        payment_status: 'Paid',
        meter_readings_id: 3,
      });

      await expect(service.remove(7)).rejects.toThrow(ConflictException);
      await expect(service.remove(7)).rejects.toThrow(/ชำระเงินแล้ว ลบไม่ได้/);

      // ต้องไม่แตะทั้งฐานข้อมูลและไฟล์รูป
      expect(billRepository.manager.transaction).not.toHaveBeenCalled();
      expect(photoService.remove).not.toHaveBeenCalled();
    });

    it('บิลที่ยังค้างชำระลบได้ตามปกติ', async () => {
      billRepository.findOne.mockResolvedValue({
        id: 8,
        payment_status: 'Pending',
        meter_readings_id: 3,
      });

      const result = await service.remove(8);

      expect(result.message).toContain('8');
      expect(billRepository.manager.transaction).toHaveBeenCalled();
    });
  });

  /**
   * ด่านกันบิลซ้ำเป็นจุดเดียวในไฟล์นี้ที่เทียบเดือนแบบ string ('8' ≠ '08')
   * ที่เหลือเทียบผ่าน monthKey() ซึ่ง Number() ให้แล้ว พอสองฝั่งไม่ตรงกัน
   * บ้านที่มีบิล '08' อยู่แล้วจะออกบิลซ้ำได้อีกใบแค่ส่งเดือนมาเป็น '8'
   */
  describe('รูปแบบของเดือนที่ออกบิล', () => {
    it('หาบิลซ้ำด้วยการเทียบตัวเลข ไม่ใช่ string ที่ต้องเติมศูนย์ให้ตรงกันเป๊ะ', async () => {
      givenBaseline(1250);
      await service.createFromScan(dto({ billing_month: '8' }));

      const queryBuilder = billRepository.createQueryBuilder.mock.results[0]
        .value as Record<string, jest.Mock>;
      const conditions = queryBuilder.andWhere.mock.calls;

      // เดือนต้องถูกส่งเข้าคิวรีเป็นเลข 8 ไม่ใช่ string '8' ที่เทียบกับ '08' ไม่ติด
      expect(conditions).toContainEqual([
        expect.stringContaining('CAST(bill.billing_month AS UNSIGNED)'),
        { month: 8 },
      ]);
    });

    it('บันทึกลงตารางแบบเติมศูนย์เสมอ ให้ทุกแถวอยู่ในรูปแบบเดียวกัน', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan(
        dto({ billing_month: '8', billing_year: '2026' }),
      );

      expect(bill.billing_month).toBe('08');
      expect(bill.billing_year).toBe('2026');
    });
  });

  /**
   * มิเตอร์ตัวเดิมมีจำนวนหลักคงที่ตลอดอายุการใช้งาน จำนวนหลักที่เปลี่ยนไป
   * จึงเป็นสัญญาณของ OCR อ่านผิด ไม่ใช่ความคลาดเคลื่อนที่ยอมรับได้
   */
  describe('จำนวนหลักบนหน้าปัด', () => {
    it('อ่านได้น้อยกว่าที่เคย → บล็อกและบอกว่าน่าจะอ่านหลักหาย', async () => {
      givenBaseline(1250, 5);

      await expect(
        service.createFromScan(dto({ current_unit: 1258, meter_digits: 4 })),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.createFromScan(dto({ current_unit: 1258, meter_digits: 4 })),
      ).rejects.toThrow(/อ่านหลักหาย/);
    });

    it('อ่านได้มากกว่าที่เคย → บล็อกและบอกว่าน่าจะอ่านหลักเกิน', async () => {
      givenBaseline(1250, 4);

      await expect(
        service.createFromScan(dto({ current_unit: 1258, meter_digits: 5 })),
      ).rejects.toThrow(/อ่านหลักเกิน/);
    });

    it('จับเคสที่ด่านหน่วยน้ำปล่อยผ่าน (บ้านยังไม่มีบิล เพดาน 1,000 หน่วยหลวมเกิน)', async () => {
      givenBaseline(1250, 5);

      // ใช้ไป 950 หน่วย — ต่ำกว่าเพดานของบ้านที่ยังไม่มีประวัติ ด่านหน่วยน้ำจึงปล่อยผ่าน
      await expect(
        service.createFromScan(dto({ current_unit: 2200 })),
      ).resolves.toBeDefined();

      // เลขเดียวกันเป๊ะ แต่บอกว่า OCR เห็น 4 หลัก ทั้งที่หน้าปัดบ้านนี้มี 5 → ต้องถูกบล็อก
      await expect(
        service.createFromScan(dto({ current_unit: 2200, meter_digits: 4 })),
      ).rejects.toThrow(/อ่านหลักหาย/);
    });

    it('ยืนยันแล้วผ่าน (เปลี่ยนมิเตอร์เป็นรุ่นที่หลักไม่เท่าเดิม)', async () => {
      givenBaseline(1250, 5);

      await expect(
        service.createFromScan(
          dto({
            current_unit: 1258,
            meter_digits: 4,
            confirm_digit_change: true,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('บ้านที่ยังไม่เคยจดผ่าน OCR → ไม่มีอะไรให้เทียบ ปล่อยผ่าน', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(dto({ current_unit: 1258, meter_digits: 5 })),
      ).resolves.toBeDefined();
    });

    it('กรอกเลขเองโดยไม่ผ่าน OCR → ข้ามด่านนี้ ไม่บล็อกการทำงานปกติ', async () => {
      givenBaseline(1250, 5);

      await expect(
        service.createFromScan(dto({ current_unit: 1258 })),
      ).resolves.toBeDefined();
    });
  });

  // พิกัดมาจาก body ตรง ๆ และยังไม่ได้เปิด global ValidationPipe
  // ค่าที่เกินช่วงจะไปพังที่ MySQL (error 1264) เป็น 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง
  describe('พิกัดจุดที่ถ่ายรูป', () => {
    it('ปฏิเสธละติจูดที่เกินช่วง ±90 (เคสกรอกสลับกับลองจิจูด)', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(dto({ latitude: 102.097771 })),
      ).rejects.toThrow(/ละติจูด/);
      expect(billRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('ปฏิเสธก่อนเขียนไฟล์รูป จะได้ไม่มีไฟล์กำพร้าค้างบนดิสก์', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({ longitude: 999, meter_photo: 'data:image/jpeg;base64,x' }),
        ),
      ).rejects.toThrow(/ลองจิจูด/);
      expect(photoService.save).not.toHaveBeenCalled();
    });

    it('captured_at ที่อ่านไม่ได้ถือเป็นไม่มีค่า ไม่ล้มทั้งบิล (เป็นข้อมูลประกอบ ไม่กระทบยอดเงิน)', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(dto({ captured_at: 'เมื่อเช้า' })),
      ).resolves.toBeDefined();
    });

    it('พิกัดจริงของไทยผ่านตามปกติ', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({ latitude: 14.9799, longitude: 102.097771 }),
        ),
      ).resolves.toBeDefined();
    });

    it('ปัดพิกัดให้พอดีกับ scale ของคอลัมน์ (ปัดออกจากศูนย์เหมือน MySQL)', () => {
      // EXIF แปลงจาก DMS แล้วได้เศษซ้ำ — ยาวเกิน 8 ตำแหน่งที่คอลัมน์เก็บได้
      expect(BillsService.roundCoordinate(14.983391666666667)).toBe(14.98339167);
      expect(BillsService.roundCoordinate(102.12281666666667)).toBe(102.12281667);
      // ค่าที่สั้นอยู่แล้วต้องไม่ถูกแตะ
      expect(BillsService.roundCoordinate(14.9799)).toBe(14.9799);
      // ครึ่งพอดีปัดออกจากศูนย์ทั้งสองทาง ไม่ใช่ปัดขึ้นแบบ Math.round
      expect(BillsService.roundCoordinate(-1.000000005)).toBe(-1.00000001);
    });

    /**
     * ด่านกันพิกัดซ้ำคิวรีด้วยค่าที่ส่งเข้ามา ไปเทียบกับแถวที่ MySQL ปัดไว้แล้วตอน INSERT
     * ถ้าไม่ปัดก่อน 14.983391666666667 จะไม่มีวันเท่ากับ 14.98339167 ที่อยู่ในตาราง
     * ด่านจึงเงียบทุกครั้ง แล้วแถวใหม่ก็ถูกปัดลงไปซ้ำกับแถวเดิมเป๊ะ ซึ่งเป็นสิ่งที่ด่านมีไว้กัน
     */
    it('เทียบด่านกันพิกัดซ้ำด้วยค่าที่ปัดแล้ว ไม่ใช่ค่าดิบจาก EXIF', async () => {
      givenBaseline(1250);

      await service.createFromScan(
        dto({ latitude: 14.983391666666667, longitude: 102.12281666666667 }),
      );

      const calls = meterReadingRepository.findOne.mock.calls as unknown[][];
      const coordinateLookups = calls
        .map((call) => (call[0] as { where?: Record<string, unknown> })?.where)
        .filter((where) => where !== undefined && 'latitude' in where);

      expect(coordinateLookups).toContainEqual(
        expect.objectContaining({
          latitude: 14.98339167,
          longitude: 102.12281667,
        }),
      );
    });

    it('บันทึกพิกัดที่ปัดแล้วลงตาราง จะได้เป็นเลขตัวเดียวกับที่ด่านใช้เทียบ', async () => {
      givenBaseline(1250);

      await service.createFromScan(
        dto({ latitude: 14.983391666666667, longitude: 102.12281666666667 }),
      );

      const saved = txManager.create.mock.calls as unknown[][];
      const reading = saved
        .map((call) => call[1] as Record<string, unknown>)
        .find((value) => value !== undefined && 'meter_unit' in value);

      expect(reading).toMatchObject({
        latitude: 14.98339167,
        longitude: 102.12281667,
      });
    });
  });

  /**
   * ด่านนี้จับเคสที่ทั้งด่านจำนวนหลักและด่านหน่วยพุ่งจับไม่ได้:
   * OCR อ่านผิดค่าโดยจำนวนหลักไม่เปลี่ยน (1250 → 1258)
   */
  describe('ความมั่นใจของ OCR', () => {
    it('อ่านไม่ชัด (ต่ำกว่า 0.85) → บล็อกและบอกเป็นเปอร์เซ็นต์ให้คนอ่านเข้าใจ', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({ current_unit: 1258, read_confidence: 0.62 }),
        ),
      ).rejects.toThrow(/อ่านเลขมิเตอร์ได้ไม่ชัดเจน.*62%/s);
    });

    it('ยืนยันแล้วผ่าน (คนตรวจเทียบกับรูปทีละหลักแล้ว)', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({
            current_unit: 1258,
            read_confidence: 0.62,
            confirm_low_confidence: true,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('ชัดพอ → ผ่านโดยไม่ต้องยืนยัน', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({ current_unit: 1258, read_confidence: 0.93 }),
        ),
      ).resolves.toBeDefined();
    });

    it('ไม่ส่งมา (กรอกเลขเอง) → ข้ามด่านนี้ ไม่บล็อกการทำงานปกติ', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(dto({ current_unit: 1258 })),
      ).resolves.toBeDefined();
    });
  });

  /**
   * GPS จริงไม่เคยให้ค่าเดิมเป๊ะทุกทศนิยมสองครั้ง และ EXIF บันทึกเวลาถึงวินาที
   * ค่าที่ซ้ำจึงเป็นสัญญาณว่ารูปถูกใช้ซ้ำ ไม่ใช่ความบังเอิญ
   */
  describe('รูปเก่า / รูปใช้ซ้ำ', () => {
    it('captured_at ซ้ำกับการจดที่มีอยู่แล้ว → บล็อกตาย ไม่มีปุ่มยืนยัน', async () => {
      givenBaseline(1250);
      // ไฟล์เดิมถูกอัปซ้ำ — ไม่มีสถานการณ์ที่ถูกต้องเลยที่จะเกิดเหตุการณ์นี้
      meterReadingRepository.findOne.mockResolvedValue({
        id: 77,
        members_id: 1,
      });

      const captured = new Date();
      await expect(
        service.createFromScan(dto({ captured_at: captured.toISOString() })),
      ).rejects.toThrow(/เป็นไฟล์รูปเดิมที่เคยใช้ไปแล้ว/);
    });

    it('พิกัดซ้ำเป๊ะทุกทศนิยม → ขอให้ยืนยัน (อาจเป็นหน้าเว็บ cache ค่าไว้)', async () => {
      givenBaseline(1250);
      meterReadingRepository.findOne.mockResolvedValue({
        id: 88,
        members_id: 1,
      });

      await expect(
        service.createFromScan(
          dto({ latitude: 14.9799, longitude: 102.097771 }),
        ),
      ).rejects.toThrow(/เป๊ะทุกทศนิยม/);
    });

    it('พิกัดซ้ำ + กดยืนยัน → ผ่าน', async () => {
      givenBaseline(1250);
      meterReadingRepository.findOne.mockResolvedValue({
        id: 88,
        members_id: 1,
      });

      await expect(
        service.createFromScan(
          dto({
            latitude: 14.9799,
            longitude: 102.097771,
            confirm_duplicate_location: true,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('รูปที่ถ่ายไว้เกิน 30 วันก่อนวันจด → ขอให้ยืนยัน', async () => {
      givenBaseline(1250);

      // ย้อนไป 60 วัน แต่ยังอยู่ในเดือนบิลเดียวกันไม่ได้ จึงส่ง reading_date คู่มาด้วย
      const stale = new Date();
      stale.setDate(stale.getDate() - 60);

      await expect(
        service.createFromScan(
          dto({
            captured_at: stale.toISOString(),
            reading_date: toIso(TODAY),
          }),
        ),
      ).rejects.toThrow(/เลขบนหน้าปัดในรูปอาจไม่ใช่เลขของรอบนี้/);
    });

    it('รูปที่ถ่ายวันเดียวกับที่จด → ผ่านตามปกติ', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(dto({ captured_at: new Date().toISOString() })),
      ).resolves.toBeDefined();
    });
  });

  /**
   * ของเดิมใช้ค่าเฉลี่ยของบิลทุกใบตลอดกาล ซึ่งถูกค่าโดดลากขึ้นถาวร
   * และไม่รู้จักคาบบิลที่ยาวกว่าหนึ่งเดือน
   */
  describe('เกณฑ์ "หน่วยที่ใช้ตามปกติ"', () => {
    it('median ทนค่าโดด — ท่อแตกครั้งเดียวไม่ดันเกณฑ์ขึ้นถาวร', () => {
      // ค่าเฉลี่ยของชุดนี้คือ 75 (โดนลากด้วย 400) แต่ median คือ 10
      expect(BillsService.usageBaseline([9, 8, 10, 400, 11, 12])).toBe(10.5);
    });

    it('ดูแค่ 6 เดือนล่าสุด — พฤติกรรมเก่าไม่ถ่วงเกณฑ์ของวันนี้', () => {
      // 12 เดือนแรกใช้เดือนละ 100 แล้วเปลี่ยนมาใช้ 10 — เกณฑ์ต้องตามของใหม่
      const history = [
        ...Array<number>(12).fill(100),
        ...Array<number>(6).fill(10),
      ];
      expect(BillsService.usageBaseline(history)).toBe(10);
    });

    it('ยังไม่มีประวัติ → null (ผู้เรียกต้องถอยไปใช้เพดานตายตัว)', () => {
      expect(BillsService.usageBaseline([])).toBeNull();
      // 0 หน่วยไม่ใช่ประวัติที่ใช้เทียบได้ (เดือนที่ปิดบ้านไป)
      expect(BillsService.usageBaseline([0, 0])).toBeNull();
    });
  });

  describe('กำหนดชำระและคาบบิล', () => {
    it('ใส่ due_date ให้ทุกใบ = วันจด + รอบชำระของหมู่บ้าน (ค่ากลาง 15 วัน)', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan(
        dto({ current_unit: 1300, reading_date: toIso(TODAY) }),
      );

      const expected = new Date(TODAY);
      expected.setDate(expected.getDate() + 15);
      expect(toIso(bill.due_date as Date)).toBe(toIso(expected));
    });

    it('หมู่บ้านที่ตั้งรอบชำระเองไว้ ใช้ค่าของหมู่บ้านนั้น', async () => {
      givenBaseline(1250);
      memberRepository.findOne.mockResolvedValue({ id: 1, villages_id: 7 });
      villageRepository.findOne.mockResolvedValue({
        id: 7,
        payment_due_days: 30,
      });

      const bill = await service.createFromScan(
        dto({ current_unit: 1300, reading_date: toIso(TODAY) }),
      );

      const expected = new Date(TODAY);
      expected.setDate(expected.getDate() + 30);
      expect(toIso(bill.due_date as Date)).toBe(toIso(expected));
    });

    it('บิลใบแรกของบ้าน (ยังไม่มีบิลเก่า) นับเป็นคาบเดือนเดียว', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan(dto({ current_unit: 1300 }));

      expect(bill.period_months).toBe(1);
    });
  });

  describe('วิธีกรอกเลขมิเตอร์ (กรอกมือต้องมีรูป)', () => {
    it('กรอกมือแล้วไม่แนบรูป → บล็อกตาย ไม่มีปุ่มยืนยัน', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({ current_unit: 1300, entry_method: 'manual' }),
        ),
      ).rejects.toThrow(/ต้องแนบรูปหน้าปัด/);
    });

    it('กรอกมือพร้อมรูป → ผ่าน และบันทึกว่าเป็นการกรอกมือ', async () => {
      givenBaseline(1250);
      photoService.save.mockResolvedValue('/uploads/meters/x.jpg');

      await expect(
        service.createFromScan(
          dto({
            current_unit: 1300,
            entry_method: 'manual',
            meter_photo: 'data:image/jpeg;base64,AAAA',
          }),
        ),
      ).resolves.toBeDefined();

      // ต้องเหลือร่องรอยไว้ว่าเลขนี้ไม่ได้ผ่าน OCR
      const flags = recordedFlags();
      expect(flags.some((f) => f.flag_type === 'manual_entry')).toBe(true);
    });

    it('ไม่ประกาศ entry_method แต่มีผล OCR ติดมา → ถือว่าเป็น ocr (หน้าเว็บรุ่นเก่าไม่พัง)', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan({
        members_id: 1,
        water_rates_id: 1,
        current_unit: 1300,
        billing_month: CURRENT_MONTH,
        billing_year: CURRENT_YEAR,
        read_confidence: 0.97,
      });

      expect(bill).toBeDefined();
    });
  });

  describe('เวลาที่ถ่ายรูป', () => {
    it('เวลาถ่ายเป็นอนาคต → บล็อกตาย (นาฬิกาเครื่องเพี้ยน)', async () => {
      givenBaseline(1250);

      const future = new Date();
      future.setHours(future.getHours() + 3);

      await expect(
        service.createFromScan(
          dto({ current_unit: 1300, captured_at: future.toISOString() }),
        ),
      ).rejects.toThrow(/เวลาในอนาคต/);
    });

    it('คลาดไปข้างหน้าไม่กี่นาที → ผ่าน (นาฬิกามือถือกับ server ไม่ตรงกันเป็นปกติ)', async () => {
      givenBaseline(1250);

      const slightlyAhead = new Date(Date.now() + 60_000);

      await expect(
        service.createFromScan(
          dto({
            current_unit: 1300,
            captured_at: slightlyAhead.toISOString(),
            reading_date: toIso(TODAY),
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('ถ่ายค้างไว้เกิน 24 ชม. → ผ่านแต่ติดธงไว้', async () => {
      givenBaseline(1250);

      const yesterday = new Date(Date.now() - 30 * 3_600_000);

      await service.createFromScan(
        dto({
          current_unit: 1300,
          captured_at: yesterday.toISOString(),
          reading_date: toIso(TODAY),
        }),
      );

      const flags = recordedFlags();
      expect(flags.some((f) => f.flag_type === 'stale_photo')).toBe(true);
    });
  });

  describe('ยอดค้างที่ทบเข้าบิลใบใหม่', () => {
    /** บิลเก่าที่ยังไม่จ่ายของบ้านหลังนี้ */
    const givenUnpaidBills = (bills: Record<string, unknown>[]) => {
      const builder = billRepository.createQueryBuilder() as {
        getMany: jest.Mock;
      };
      builder.getMany.mockResolvedValue(bills);
    };

    it('ไม่มีบิลค้าง → arrears เป็น 0 และ grand_total เท่ากับค่าน้ำเดือนนี้', async () => {
      givenBaseline(1250);

      const bill = await service.createFromScan(dto({ current_unit: 1300 }));

      expect(Number(bill.arrears_amount)).toBe(0);
      expect(Number(bill.grand_total)).toBe(Number(bill.total_amount));
    });

    it('มีบิลค้าง 2 ใบ → ทบเข้า grand_total แต่ total_amount ยังเป็นค่าน้ำเดือนนี้ล้วน', async () => {
      givenBaseline(1250);
      // เดือนก่อนหน้าทั้งคู่ ไม่งั้นจะไปชนด่าน "มีบิลใหม่กว่าอยู่"
      givenUnpaidBills([
        {
          id: 11,
          billing_month: '01',
          billing_year: '2000',
          current_unit: 1000,
          usage_unit: 10,
          total_amount: '150.00',
          payment_status: 'Pending',
        },
        {
          id: 12,
          billing_month: '02',
          billing_year: '2000',
          current_unit: 1010,
          usage_unit: 10,
          total_amount: '200.00',
          payment_status: 'Overdue',
        },
      ]);

      const bill = await service.createFromScan(dto({ current_unit: 1300 }));

      // เลขตั้งต้นมาจากบิลใบล่าสุด (1010) ไม่ใช่การจดตอนลงทะเบียน
      expect(Number(bill.usage_unit)).toBe(290);
      expect(Number(bill.total_amount)).toBe(290 * 15);
      expect(Number(bill.arrears_amount)).toBe(350);
      expect(Number(bill.grand_total)).toBe(290 * 15 + 350);
    });

    it('บิลที่จ่ายแล้วไม่ถูกทบซ้ำ', async () => {
      givenBaseline(1250);
      givenUnpaidBills([
        {
          id: 11,
          billing_month: '01',
          billing_year: '2000',
          current_unit: 1000,
          usage_unit: 10,
          total_amount: '150.00',
          payment_status: 'Paid',
        },
      ]);

      const bill = await service.createFromScan(dto({ current_unit: 1300 }));

      expect(Number(bill.arrears_amount)).toBe(0);
    });
  });

  describe('รับชำระเงิน', () => {
    it('ปิดใบเก่าที่ถูกทบยอดไปพร้อมกัน ไม่ใช่ปิดแค่ใบเดียว', async () => {
      billRepository.findOne.mockResolvedValue({
        id: 5,
        payment_status: 'Pending',
        total_amount: '300.00',
        grand_total: '650.00',
      });
      billArrearsRepository.find.mockResolvedValue([
        { bill_id: 5, covered_bill_id: 3 },
        { bill_id: 5, covered_bill_id: 4 },
      ]);

      const result = await service.payBill(5, 1);

      expect(result.settled_bill_ids).toEqual([3, 4]);
      expect(result.paid_amount).toBe(650);
    });

    it('บิลที่จ่ายแล้ว กดรับเงินซ้ำไม่ได้', async () => {
      billRepository.findOne.mockResolvedValue({
        id: 5,
        payment_status: 'Paid',
        total_amount: '300.00',
      });

      await expect(service.payBill(5)).rejects.toThrow(ConflictException);
    });
  });

  describe('แก้เลขมิเตอร์ของบิลที่ออกไปแล้ว', () => {
    const OWNER = { id: 1, admin_role: 'owner' as const };
    const STAFF = { id: 2, admin_role: 'staff' as const };

    /** ค่าตั้งต้นที่ถูกต้องของ input แล้วค่อยแก้เฉพาะที่อยากทดสอบ */
    const edit = (overrides: Record<string, unknown> = {}) => ({
      current_unit: '1310',
      reason: 'OCR อ่านหลักสุดท้ายผิด เทียบกับรูปแล้วเป็น 1310',
      ...overrides,
    });

    /**
     * บิลที่ออกไปแล้วหนึ่งใบ พร้อมการจดที่ผูกอยู่
     *
     * เลขตั้งต้น 1250 มาจากการจดตอนลงทะเบียน (ไม่มีบิลเดือนก่อนในเทสต์ชุดนี้)
     * วันที่จดตั้งเป็นปี 2000 = "ไม่ใช่วันนี้" แน่นอนโดยไม่ต้องฮาร์ดโค้ดวันจริง
     */
    const givenBill = (
      bill: Record<string, unknown> = {},
      reading: Record<string, unknown> = {},
    ) => {
      waterRateRepository.findOne.mockResolvedValue({
        id: 1,
        price_per_unit: '15.00',
      });
      billRepository.findOne.mockResolvedValue({
        id: 5,
        meter_readings_id: 50,
        water_rates_id: 1,
        billing_month: CURRENT_MONTH,
        billing_year: CURRENT_YEAR,
        previous_unit: 1250,
        current_unit: 1300,
        usage_unit: 50,
        total_amount: '750.00',
        arrears_amount: '0.00',
        grand_total: '750.00',
        period_months: 1,
        payment_status: 'Pending',
        ...bill,
      });
      meterReadingRepository.findOne.mockResolvedValue({
        id: 50,
        members_id: 1,
        meter_unit: 1300,
        reading_date: '2000-01-15',
        evidence_photo: null,
        ...reading,
      });
      meterReadingRepository.find.mockResolvedValue([
        { id: 49, meter_unit: 1250 },
      ]);
    };

    /** รหัสด่านที่แนบมากับ error (undefined = error ธรรมดา ไม่มีปุ่มยืนยัน) */
    const codeOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return null;
      } catch (error) {
        const body = (error as BadRequestException).getResponse() as {
          code?: string;
        };
        return body?.code;
      }
    };

    it('บิลที่จ่ายแล้วแก้ไม่ได้ แม้จะเป็น owner', async () => {
      givenBill({ payment_status: 'Paid' });

      await expect(service.updateReading(5, edit(), OWNER)).rejects.toThrow(
        ConflictException,
      );
    });

    it('ไม่กรอกเหตุผล = ไม่แก้ให้', async () => {
      givenBill();

      await expect(
        service.updateReading(5, edit({ reason: '   ' }), OWNER),
      ).rejects.toThrow(BadRequestException);
      expect(readingLogsService.record).not.toHaveBeenCalled();
    });

    it('staff แก้บิลที่เลยกำหนดและไม่ได้จดวันนี้ไม่ได้', async () => {
      givenBill({ payment_status: 'Overdue' });

      await expect(service.updateReading(5, edit(), STAFF)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('staff แก้บิลที่ยังรอชำระได้', async () => {
      givenBill({ payment_status: 'Pending' });

      const result = await service.updateReading(5, edit(), STAFF);

      expect(result.usage_unit).toBe(60);
      expect(result.total_amount).toBe(900);
    });

    it('staff แก้บิลที่เลยกำหนดได้ ถ้าเป็นการจดของวันนี้', async () => {
      givenBill({ payment_status: 'Overdue' }, { reading_date: toIso(TODAY) });

      const result = await service.updateReading(5, edit(), STAFF);

      expect(result.usage_unit).toBe(60);
    });

    it('owner แก้บิลที่เลยกำหนดได้ตลอด', async () => {
      givenBill({ payment_status: 'Overdue' });

      const result = await service.updateReading(5, edit(), OWNER);

      expect(result.total_amount).toBe(900);
    });

    it('เลขใหม่ต่ำกว่าเลขตั้งต้น → 400 พร้อม code meter_reset', async () => {
      givenBill();

      expect(
        await codeOf(
          service.updateReading(5, edit({ current_unit: '20' }), OWNER),
        ),
      ).toBe('meter_reset');
    });

    it('กดยืนยันเปลี่ยนมิเตอร์แล้ว เริ่มนับจาก 0', async () => {
      givenBill();

      const result = await service.updateReading(
        5,
        edit({ current_unit: '20', confirm_meter_reset: 'true' }),
        OWNER,
      );

      expect(result.usage_unit).toBe(20);
    });

    it('หน่วยพุ่งเกินเพดาน → 400 พร้อม code high_usage', async () => {
      givenBill();

      expect(
        await codeOf(
          service.updateReading(5, edit({ current_unit: '9250' }), OWNER),
        ),
      ).toBe('high_usage');
    });

    it('กดยืนยันหน่วยพุ่งแล้วแก้ได้', async () => {
      givenBill();

      const result = await service.updateReading(
        5,
        edit({ current_unit: '9250', confirm_high_usage: 'true' }),
        OWNER,
      );

      expect(result.usage_unit).toBe(8000);
    });

    it('บันทึกร่องรอยว่าใครแก้จากเท่าไหร่เป็นเท่าไหร่ ด้วยเหตุผลอะไร', async () => {
      givenBill();

      await service.updateReading(5, edit(), STAFF);

      expect(readingLogsService.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bills_id: 5,
          old_unit: 1300,
          new_unit: 1310,
          old_usage_unit: 50,
          new_usage_unit: 60,
          old_total_amount: 750,
          new_total_amount: 900,
          reason: edit().reason,
          changed_by: 2,
          changed_role: 'staff',
        }),
      );
    });

    it('ใบที่ทบยอดใบนี้ไว้ ถูกคิดยอดค้างใหม่ตามไปด้วย', async () => {
      givenBill();
      // ใบที่ 9 ทบยอดใบที่ 5 ไว้ 750 บาท (ยอดก่อนแก้)
      const link = { id: 7, bill_id: 9, covered_bill_id: 5, amount: '750.00' };
      txManager.find.mockImplementation(
        (_entity: unknown, options: { where?: Record<string, number> }) =>
          Promise.resolve(options?.where?.covered_bill_id ? [link] : [link]),
      );
      txManager.findOne.mockResolvedValue({
        id: 9,
        total_amount: '300.00',
        payment_status: 'Pending',
      });

      await service.updateReading(5, edit(), OWNER);

      expect(txManager.update).toHaveBeenCalledWith(BillArrearsEntity, 7, {
        amount: 900,
      });
      expect(txManager.update).toHaveBeenCalledWith(BillEntity, 9, {
        arrears_amount: 900,
        grand_total: 1200,
      });
    });

    it('ใบที่จ่ายเงินไปแล้วไม่ถูกเขียนทับ', async () => {
      givenBill();
      const link = { id: 7, bill_id: 9, covered_bill_id: 5, amount: '750.00' };
      txManager.find.mockResolvedValue([link]);
      txManager.findOne.mockResolvedValue({
        id: 9,
        total_amount: '300.00',
        payment_status: 'Paid',
      });

      await service.updateReading(5, edit(), OWNER);

      expect(txManager.update).not.toHaveBeenCalledWith(
        BillArrearsEntity,
        7,
        expect.anything(),
      );
    });

    it('แนบรูปใหม่ = ลบไฟล์รูปเดิมทิ้งหลังบันทึกสำเร็จ', async () => {
      givenBill({}, { evidence_photo: '/uploads/meters/old.jpg' });
      photoService.save.mockResolvedValue('/uploads/meters/new.jpg');

      await service.updateReading(
        5,
        edit({ photo: 'data:image/jpeg;base64,AAAA' }),
        OWNER,
      );

      expect(photoService.remove).toHaveBeenCalledWith(
        '/uploads/meters/old.jpg',
      );
    });

    it('ไม่แนบรูปใหม่ = ไม่ไปแตะไฟล์รูปเดิม', async () => {
      givenBill({}, { evidence_photo: '/uploads/meters/old.jpg' });

      await service.updateReading(5, edit(), OWNER);

      expect(photoService.remove).not.toHaveBeenCalled();
    });
  });

  /**
   * ที่มาของ "บ้าน" ในแต่ละใบ — คอลัมน์ที่ทำให้คำถาม "ระบบเลือกบ้านเองแล้วผิดกี่ %"
   * ตอบได้เป็นครั้งแรก ก่อนหน้านี้ meter_readings เก็บแค่ entry_method ซึ่งตอบเรื่องเลข
   * ไม่ได้ตอบเรื่องบ้าน และแถวที่ถืออยู่ก็ถูกลบทิ้งทุกครั้งที่มีคนไปแก้ใบที่ผิด
   */
  describe('ร่องรอยว่าใครเลือกบ้านให้ใบนี้', () => {
    /** ค่าที่ถูกส่งเข้า manager.create() สำหรับตารางที่มีคีย์ตัวชี้วัดนี้ */
    const created = (marker: string): Record<string, unknown> | undefined => {
      const calls = txManager.create.mock.calls as unknown[][];
      return calls
        .map((call) => call[1] as Record<string, unknown>)
        .find((value) => value && marker in value);
    };

    it('เก็บที่มาของการจับคู่บ้านลงแถวการจด', async () => {
      givenBaseline(1250);

      await service.createFromScan(
        dto({ matched_by: 'system', match_confidence: 'high' }),
      );

      const reading = created('meter_unit')!;
      expect(reading.matched_by).toBe('system');
      expect(reading.match_confidence).toBe('high');
    });

    /**
     * ค่ามาจาก client ซึ่งปลอมได้ ต่างจาก read_confidence ที่หลังบ้านคำนวณเอง —
     * ค่าที่ไม่รู้จักจึงต้องกลายเป็น null เงียบ ๆ ไม่ใช่โยน error ทิ้งทั้งบิล
     * (ฟิลด์บันทึกประวัติห้ามขวางบิลที่คนไปยืนจดมาแล้ว)
     */
    it('ค่าที่ไม่รู้จักเก็บเป็น null ไม่ใช่ปฏิเสธทั้งใบ', async () => {
      givenBaseline(1250);

      await expect(
        service.createFromScan(
          dto({ matched_by: 'ระบบเดาเอง', match_confidence: 'มั่นใจมาก' }),
        ),
      ).resolves.toBeDefined();

      const reading = created('meter_unit')!;
      expect(reading.matched_by).toBeNull();
      expect(reading.match_confidence).toBeNull();
    });

    it('หน้าเว็บรุ่นเก่าที่ยังไม่ส่งฟิลด์นี้มา ต้องออกบิลได้ตามเดิม', async () => {
      givenBaseline(1250);

      await expect(service.createFromScan(dto())).resolves.toBeDefined();
      expect(created('meter_unit')!.matched_by).toBeNull();
    });

    /**
     * บ้านของบิลที่ออกไปแล้วแก้ไม่ได้ (UpdateReadingDto ไม่มี members_id) ทางแก้
     * "ออกบิลผิดบ้าน" จึงมีทางเดียวคือลบทิ้งแล้วออกใหม่ — และ remove() ลบแถวการจด
     * ที่ถือ matched_by ไปด้วยเสมอ ถ้าไม่เก็บสำเนาก่อน หลักฐานของความผิดพลาด
     * จะถูกลบทิ้งพอดีกับจังหวะที่มันมีค่าที่สุด
     */
    describe('ลบบิลทิ้ง', () => {
      const givenBillToDelete = () => {
        billRepository.findOne.mockResolvedValue({
          id: 7,
          meter_readings_id: 42,
          billing_month: '08',
          billing_year: '2026',
          total_amount: 250,
          payment_status: 'Unpaid',
        });
        txManager.findOne.mockImplementation((entity: { name?: string }) =>
          Promise.resolve(
            entity === MeterReadingEntity
              ? {
                  id: 42,
                  members_id: 3,
                  meter_unit: 1250,
                  matched_by: 'system',
                  match_confidence: 'high',
                  entry_method: 'ocr',
                  evidence_photo: null,
                }
              : { id: 3, house_no: '99/1' },
          ),
        );
      };

      it('เก็บสำเนาที่มาของการจับคู่บ้านไว้ก่อนลบ', async () => {
        givenBillToDelete();

        await service.remove(7);

        const log = created('bills_id')!;
        expect(log.matched_by).toBe('system');
        expect(log.match_confidence).toBe('high');
        expect(log.members_id).toBe(3);
        // เลขที่บ้านเก็บซ้ำเป็นข้อความ ไว้อ่านออกแม้บ้านถูกลบทีหลัง
        expect(log.house_no).toBe('99/1');
      });

      it('ต้องเขียน log ก่อนลบแถว ไม่ใช่หลัง — แถวที่ถือค่าจะหายไปแล้ว', async () => {
        givenBillToDelete();

        await service.remove(7);

        const logOrder = txManager.save.mock.invocationCallOrder[0];
        const deleteOrder = txManager.delete.mock.invocationCallOrder[0];
        expect(logOrder).toBeLessThan(deleteOrder);
      });

      it('บิลที่จ่ายเงินแล้วยังลบไม่ได้เหมือนเดิม และต้องไม่เหลือ log ค้างไว้', async () => {
        billRepository.findOne.mockResolvedValue({
          id: 7,
          meter_readings_id: 42,
          payment_status: 'Paid',
        });

        await expect(service.remove(7)).rejects.toThrow(ConflictException);
        expect(txManager.save).not.toHaveBeenCalled();
      });
    });
  });
});
