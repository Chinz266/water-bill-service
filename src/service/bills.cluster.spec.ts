import { Repository } from 'typeorm';
import { BillsService } from './bills.service';
import { BillEntity } from '../entity/bill.entity';
import { WaterRateEntity } from '../entity/water-rate.entity';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { VillageEntity } from '../entity/village.entity';
import { BillArrearsEntity } from '../entity/bill-arrears.entity';
import { MeterEntity } from '../entity/meter.entity';
import { MeterPhotoService } from './meter-photo.service';
import { ReadingFlagsService } from './reading-flags.service';
import { ReadingLogsService } from './reading-logs.service';
import { CreateBillFromScanDto } from '../dto/create-bill-from-scan.dto';

/**
 * มิเตอร์ที่ติดกันบนกำแพงเดียวกัน (cluster) — ด่านที่ใช้ระยะทางต้องเงียบทั้งกลุ่ม
 *
 * ตัวเลขที่ทำให้เรื่องนี้ไม่ใช่เรื่องของการปรับค่า: มิเตอร์ห่างกัน 0.3 ม. ส่วน GPS มือถือ
 * คลาดเคลื่อน 3-5 ม. ในที่โล่ง และ 10-30 ม. ใต้ชายคา — ความคลาดเคลื่อนกว้างกว่าระยะจริง
 * สิบถึงร้อยเท่า ไม่ว่าจะตั้งรัศมีเท่าไหร่ก็แยกตัวซ้าย/ตัวขวาไม่ได้
 *
 * ผลคือคนที่เดินจดถูกต้องทุกขั้นตอนจะโดนด่าน "ยืนที่เดิมกดชัตเตอร์รัว" และ
 * "พิกัดซ้ำเป๊ะทุกทศนิยม" ทุกครั้ง เทสต์ชุดนี้ล็อกไว้ว่าสองด่านนั้นต้องข้ามให้กลุ่มนี้
 * และตัวที่มาแทนคือการเทียบ current_unit กับ previous_unit ของแต่ละหลัง
 */
const TODAY = new Date();
const CURRENT_MONTH = String(TODAY.getMonth() + 1).padStart(2, '0');
const CURRENT_YEAR = String(TODAY.getFullYear());

/** การจดที่ถูกบันทึกไว้แล้วในตาราง (เท่าที่ด่านในเทสต์ชุดนี้ต้องใช้) */
interface StoredReading {
  id: number;
  members_id: number;
  captured_at: Date | null;
  latitude: number;
  longitude: number;
}

/** ตัวกรองเท่าที่ service เรียกใช้จริง — members_id อาจเป็น FindOperator (Not(In([...]))) */
interface WhereClause {
  id?: number;
  members_id?: number | { value?: unknown };
  latitude?: number;
  longitude?: number;
  cluster_group_id?: string;
}

interface FindArgs {
  where?: WhereClause;
}

/** ไล่ลงไปหา array ที่อยู่ในสุดของ FindOperator ที่ซ้อนกัน (Not(In([1, 2]))) */
const idsInside = (operator: unknown): number[] => {
  if (Array.isArray(operator)) return operator as number[];
  if (operator && typeof operator === 'object' && 'value' in operator) {
    return idsInside(operator.value);
  }
  return [];
};

describe('BillsService — กลุ่มมิเตอร์ที่ติดกัน', () => {
  let service: BillsService;
  let billRepository: Record<string, jest.Mock>;
  let waterRateRepository: Record<string, jest.Mock>;
  let meterReadingRepository: Record<string, jest.Mock>;
  let memberRepository: Record<string, jest.Mock>;

  /** บ้านสามหลังที่มิเตอร์เรียงติดกันบนกำแพงเดียวกัน */
  const wall = [
    {
      id: 1,
      house_no: '206/1',
      villages_id: null,
      cluster_group_id: 'WALL-206',
      sequence_index: 1,
    },
    {
      id: 2,
      house_no: '206/2',
      villages_id: null,
      cluster_group_id: 'WALL-206',
      sequence_index: 2,
    },
    {
      id: 3,
      house_no: '206/3',
      villages_id: null,
      cluster_group_id: 'WALL-206',
      sequence_index: 3,
    },
  ];

  /** เลขตั้งต้นของแต่ละบ้าน — ใช้เป็นการจดตอนลงทะเบียน (ยังไม่มีบิลเก่า) */
  let previousUnits: Record<number, number>;
  /** การจดที่บันทึกไว้แล้ว ใช้เป็นคู่เทียบของด่านถ่ายรัว/พิกัดซ้ำ */
  let storedReadings: StoredReading[];

  beforeEach(() => {
    previousUnits = { 1: 1200, 2: 3800, 3: 500 };
    storedReadings = [];

    const queryBuilder = {
      innerJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getMany: jest.fn().mockResolvedValue([]),
      getRawAndEntities: jest.fn().mockResolvedValue({ entities: [], raw: [] }),
    };

    const txManager = {
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
        transaction: jest.fn((cb: (m: Record<string, jest.Mock>) => unknown) =>
          Promise.resolve(cb(txManager)),
        ),
      } as unknown as jest.Mock,
    };

    waterRateRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 1, price_per_unit: '15.00' }),
    };

    // find() ถูกใช้สองทาง: หาเลขตั้งต้นของบ้านหนึ่ง (where.members_id)
    // กับหาการจดรอบ ๆ เวลาที่ถ่าย (where.captured_at) — แยกด้วยรูปของ where
    meterReadingRepository = {
      find: jest.fn((options: FindArgs) => {
        const where = options.where ?? {};
        if (typeof where.members_id === 'number') {
          const unit = previousUnits[where.members_id];
          return Promise.resolve(
            unit === undefined
              ? []
              : [{ id: 100 + where.members_id, meter_unit: unit }],
          );
        }
        // ด่านถ่ายรัว: คืนการจดที่บันทึกไว้แล้วทั้งหมด
        return Promise.resolve(storedReadings);
      }),
      findOne: jest.fn((options: FindArgs) => {
        const where = options.where ?? {};
        const match = storedReadings.find(
          (shot) =>
            shot.latitude === where.latitude &&
            shot.longitude === where.longitude,
        );
        if (!match) return Promise.resolve(null);
        // ด่านพิกัดซ้ำเป๊ะ — members_id เป็น Not(In([...])) ของบ้านในกลุ่มเดียวกัน
        const excluded = idsInside(where.members_id);
        return Promise.resolve(
          excluded.includes(match.members_id) ? null : match,
        );
      }),
    };

    memberRepository = {
      find: jest.fn((options: FindArgs) => {
        const cluster = options.where?.cluster_group_id;
        return Promise.resolve(
          cluster ? wall.filter((m) => m.cluster_group_id === cluster) : [],
        );
      }),
      findOne: jest.fn().mockResolvedValue({ id: 1, villages_id: null }),
      findOneBy: jest.fn((where: WhereClause) =>
        Promise.resolve(wall.find((m) => m.id === where.id) ?? null),
      ),
    };

    service = new BillsService(
      billRepository as unknown as Repository<BillEntity>,
      waterRateRepository as unknown as Repository<WaterRateEntity>,
      meterReadingRepository as unknown as Repository<MeterReadingEntity>,
      memberRepository as unknown as Repository<MemberEntity>,
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<VillageEntity>,
      {
        remove: jest.fn().mockResolvedValue(undefined),
        save: jest.fn(),
      } as unknown as MeterPhotoService,
      {
        find: jest.fn().mockResolvedValue([]),
      } as unknown as Repository<BillArrearsEntity>,
      {
        findOne: jest.fn().mockResolvedValue(null),
      } as unknown as Repository<MeterEntity>,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as ReadingFlagsService,
      {
        record: jest.fn().mockResolvedValue(undefined),
      } as unknown as ReadingLogsService,
    );
  });

  const dto = (overrides: Partial<CreateBillFromScanDto> = {}) =>
    ({
      members_id: 1,
      water_rates_id: 1,
      current_unit: 1250,
      billing_month: CURRENT_MONTH,
      billing_year: CURRENT_YEAR,
      entry_method: 'ocr',
      ...overrides,
    }) as CreateBillFromScanDto;

  describe('ด่านที่ตัดสินด้วยระยะทาง', () => {
    it('ถ่ายตัวถัดไปในกลุ่มห่างกันไม่กี่วินาที → ต้องไม่ฟ้อง "ยืนที่เดิมกดชัตเตอร์รัว"', async () => {
      const captured = new Date(TODAY.getTime() - 60 * 1000);
      storedReadings = [
        {
          id: 50,
          members_id: 2,
          captured_at: new Date(captured.getTime() - 3000),
          latitude: 14.9799,
          longitude: 102.097771,
        },
      ];

      await expect(
        service.createFromScan(
          dto({
            members_id: 1,
            captured_at: captured.toISOString(),
            latitude: 14.9799,
            longitude: 102.09777,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('บ้านนอกกลุ่มยังโดนด่านถ่ายรัวเหมือนเดิม (ด่านไม่ได้ถูกปิดทั้งระบบ)', async () => {
      const captured = new Date(TODAY.getTime() - 60 * 1000);
      storedReadings = [
        {
          id: 51,
          members_id: 9, // บ้านนอกกลุ่ม WALL-206
          captured_at: new Date(captured.getTime() - 3000),
          latitude: 14.9799,
          longitude: 102.097771,
        },
      ];

      await expect(
        service.createFromScan(
          dto({
            members_id: 1,
            captured_at: captured.toISOString(),
            latitude: 14.9799,
            longitude: 102.09777,
          }),
        ),
      ).rejects.toThrow(/ยืนอยู่ที่เดิม/);
    });

    it('พิกัดตรงเป๊ะกับเพื่อนบ้านในกลุ่ม → ผ่าน (GPS ให้ค่าเดิมได้จริงที่ระยะ 30 ซม.)', async () => {
      storedReadings = [
        {
          id: 52,
          members_id: 3,
          captured_at: null,
          latitude: 14.9799,
          longitude: 102.097771,
        },
      ];

      await expect(
        service.createFromScan(
          dto({ members_id: 1, latitude: 14.9799, longitude: 102.097771 }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('ตัวเลขมาแทนพิกัด', () => {
    it('เลขต่ำกว่าเลขตั้งต้นของหลังที่เลือก แต่เข้ากับอีกหลังในกลุ่ม → บอกว่าจดสลับตัว', async () => {
      // 206/1 ตั้งต้น 1200 · 206/3 ตั้งต้น 500 — เลข 600 เป็นของ 206/3
      await expect(
        service.createFromScan(dto({ members_id: 1, current_unit: 600 })),
      ).rejects.toThrow(/206\/3/);
    });

    it('ข้อความต้องบอกตำแหน่งซ้าย/ขวา ไม่ใช่แค่บ้านเลขที่', async () => {
      await expect(
        service.createFromScan(dto({ members_id: 1, current_unit: 600 })),
      ).rejects.toThrow(/ขวาสุด/);
    });

    it('ยืนยันเปลี่ยนมิเตอร์มาแล้ว → เป็นคนละเรื่อง ปล่อยให้ด่านเดิมทำงาน', async () => {
      await expect(
        service.createFromScan(
          dto({
            members_id: 1,
            current_unit: 600,
            confirm_meter_reset: true,
            old_meter_final_unit: 1300,
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('เลขไม่เข้ากับหลังไหนในกลุ่มเลย → ด่านเปลี่ยนมิเตอร์เดิมตอบแทน', async () => {
      // ต่ำกว่าเลขตั้งต้นของทุกหลังในกลุ่ม (206/3 ต่ำสุดที่ 500)
      await expect(
        service.createFromScan(dto({ members_id: 1, current_unit: 100 })),
      ).rejects.toThrow(/เปลี่ยนมิเตอร์/);
    });
  });

  describe('ป้ายบอกตำแหน่ง', () => {
    it.each([
      [1, 3, 'ซ้ายสุด'],
      [2, 3, 'ตรงกลาง'],
      [3, 3, 'ขวาสุด'],
      [2, 4, 'ตัวที่ 2 จากซ้าย'],
      [null, 3, 'ยังไม่ได้ระบุตำแหน่ง'],
    ])('ลำดับ %s จาก %s ตัว → "%s"', (index, total, label) => {
      expect(BillsService.positionLabel(index, total)).toBe(label);
    });
  });
});
