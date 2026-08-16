import {
  BadRequestException,
  ConflictException,
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
  let memberRepository: { find: jest.Mock; findOne: jest.Mock };
  let villageRepository: { findOne: jest.Mock };
  let photoService: { remove: jest.Mock; save: jest.Mock };

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

    billRepository = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => queryBuilder),
      manager: {
        // รันคอลแบ็กจริงด้วย manager ปลอม จะได้เห็นค่าที่คำนวณได้จริง ๆ ในบิลที่คืนออกมา
        transaction: jest.fn((cb: (m: Record<string, jest.Mock>) => unknown) =>
          Promise.resolve(
            cb({
              delete: jest.fn(),
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn((_entity: unknown, value: unknown) => value),
              save: jest.fn((value: Record<string, unknown>) =>
                Promise.resolve({ id: 99, ...value }),
              ),
              findOne: jest.fn().mockResolvedValue(null),
            }),
          ),
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
    };
    villageRepository = { findOne: jest.fn().mockResolvedValue(null) };
    photoService = {
      remove: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(),
    };

    service = new BillsService(
      billRepository as unknown as Repository<BillEntity>,
      waterRateRepository as unknown as Repository<WaterRateEntity>,
      meterReadingRepository as unknown as Repository<MeterReadingEntity>,
      memberRepository as unknown as Repository<MemberEntity>,
      villageRepository as unknown as Repository<VillageEntity>,
      photoService as unknown as MeterPhotoService,
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

  /** dto ตั้งต้นที่ถูกต้องทุกอย่าง แล้วค่อยแก้เฉพาะ field ที่อยากทดสอบ */
  const dto = (overrides: Partial<CreateBillFromScanDto> = {}) => ({
    members_id: 1,
    water_rates_id: 1,
    current_unit: 1250,
    billing_month: CURRENT_MONTH,
    billing_year: CURRENT_YEAR,
    ...overrides,
  });

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
});
