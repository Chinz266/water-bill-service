import { Repository } from 'typeorm';
import { ScanBatchService } from './scan-batch.service';
import { BillsService } from './bills.service';
import { MeterReadingsService } from './meter-readings.service';
import { MemberEntity } from '../entity/member.entity';
import { VillageEntity } from '../entity/village.entity';
import { PhotoMetadata, PhotoMetadataService } from './photo-metadata.service';
import { ScanBatchDto } from '../dto/scan-batch.dto';

/**
 * รูปของมิเตอร์ที่ติดกันบนกำแพงเดียวกัน — พิกัดต้องไม่ถูกใช้ตัดสินอะไรเลย
 *
 * ทั้งสองบ้านในกลุ่มอยู่ห่างจากจุดถ่ายรูปคนละไม่กี่เซนติเมตร แต่ค่าที่วัดได้จะต่างกัน
 * เป็นเมตรตามการแกว่งของสัญญาณ ถ้าปล่อยให้ gpsTiebreak ทำงาน ระบบจะเสนอบ้านที่
 * "ใกล้กว่า" ตามเสียงรบกวน แล้วคนจะเซ็นรับรองการเดาที่ดูน่าเชื่อถือ
 */
type Baseline = Awaited<ReturnType<BillsService['previousUnitsForMembers']>>;

const member = (
  id: number,
  house_no: string,
  over: Partial<MemberEntity> = {},
): MemberEntity =>
  ({
    id,
    house_no,
    fname: 'สมชาย',
    lname: 'ใจดี',
    cluster_group_id: null,
    sequence_index: null,
    ...over,
  }) as MemberEntity;

/** สองหลังใช้มิเตอร์ที่ติดกัน (WALL-206) อีกหลังเป็นบ้านเดี่ยวคนละฝั่งถนน */
const MEMBERS = [
  member(1, '206/1', {
    latitude: 14.9799 as unknown as number,
    longitude: 102.097771 as unknown as number,
    cluster_group_id: 'WALL-206',
    sequence_index: 1,
  }),
  member(2, '206/2', {
    latitude: 14.97990269 as unknown as number,
    longitude: 102.097771 as unknown as number,
    cluster_group_id: 'WALL-206',
    sequence_index: 2,
  }),
  member(3, '300', {
    latitude: 14.9825 as unknown as number,
    longitude: 102.0978 as unknown as number,
  }),
];

const baselineOf = (
  rows: Record<number, { previous_unit: number; usage_history: number[] }>,
): Baseline => {
  const map = new Map();
  for (const [id, row] of Object.entries(rows)) {
    map.set(Number(id), {
      previous_unit: row.previous_unit,
      source: 'bill' as const,
      usage_history: row.usage_history,
      typical_usage: BillsService.usageBaseline(row.usage_history),
      already_billed: false,
    });
  }
  return map as Baseline;
};

const fakeFile = (name = 'meter.jpg') =>
  ({ originalname: name, buffer: Buffer.from('x') }) as Express.Multer.File;

const ocrResult = (integer_part: string) => ({
  success: true,
  read_unit: integer_part,
  integer_part,
  decimal_part: null,
  full_reading: integer_part,
  meter_digits: integer_part.length,
  confidence: 0.93,
  message: 'สกัดค่าตัวเลขสำเร็จ',
});

/** รูปที่ถ่ายอยู่หน้ากลุ่มมิเตอร์ — พิกัดเดียวกันเป๊ะทั้งสองใบ ซึ่งเกิดขึ้นจริง */
const atWall = (capturedAt: Date): PhotoMetadata => ({
  has_exif: true,
  captured_at: capturedAt,
  latitude: 14.9799,
  longitude: 102.097771,
});

const dto: ScanBatchDto = { billing_month: '08', billing_year: '2026' };

describe('ScanBatchService — กลุ่มมิเตอร์ที่ติดกัน', () => {
  let service: ScanBatchService;
  let memberRepository: { find: jest.Mock };
  let villageRepository: { findOne: jest.Mock };
  let meterReadingsService: { extractMeterUnit: jest.Mock };
  let billsService: Record<string, jest.Mock>;
  let photoMetadataService: { read: jest.Mock };

  beforeEach(() => {
    memberRepository = { find: jest.fn().mockResolvedValue(MEMBERS) };
    villageRepository = { findOne: jest.fn().mockResolvedValue(null) };
    meterReadingsService = { extractMeterUnit: jest.fn() };
    billsService = {
      previousUnitsForMembers: jest.fn().mockResolvedValue(
        baselineOf({
          // เลขตั้งต้นใกล้กันมาก = เลขมิเตอร์แยกสองหลังนี้ไม่ออก
          // ซึ่งเป็นจุดที่ของเดิมจะหันไปพึ่งพิกัด
          1: { previous_unit: 1200, usage_history: [10, 9, 11] },
          2: { previous_unit: 1195, usage_history: [10, 11, 9] },
          3: { previous_unit: 8000, usage_history: [12, 13, 12] },
        }),
      ),
      readingsOfMembers: jest.fn().mockResolvedValue([]),
      learnedMeterLocations: jest.fn().mockReturnValue(new Map()),
      knownMeterDigits: jest.fn().mockReturnValue(new Map()),
    };
    photoMetadataService = {
      read: jest.fn().mockReturnValue(atWall(new Date())),
    };

    service = new ScanBatchService(
      memberRepository as unknown as Repository<MemberEntity>,
      villageRepository as unknown as Repository<VillageEntity>,
      meterReadingsService as unknown as MeterReadingsService,
      billsService as unknown as BillsService,
      photoMetadataService as unknown as PhotoMetadataService,
    );
  });

  it('เลขเข้าได้ทั้งสองหลังในกลุ่ม → ต้องคืน ambiguous ไม่ใช่ให้พิกัดตัดสิน', async () => {
    meterReadingsService.extractMeterUnit.mockResolvedValue(ocrResult('1210'));

    const res = await service.analyze([fakeFile()], dto);
    const item = res.results[0];

    expect(item.confidence).toBe('ambiguous');
    expect(item.suggestion).toBeNull();
  });

  it('เหตุผลต้องบอกว่าให้จดตามลำดับตำแหน่ง ไม่ใช่บอกว่าหลังไหนใกล้กว่า', async () => {
    meterReadingsService.extractMeterUnit.mockResolvedValue(ocrResult('1210'));

    const res = await service.analyze([fakeFile()], dto);

    expect(res.results[0].reason).toMatch(/ลำดับ/);
    // ห้ามฟันธงว่าหลังไหนใกล้กว่า — นั่นคือสิ่งที่ gpsTiebreak เคยตอบ
    expect(res.results[0].reason).not.toMatch(/จึงน่าจะเป็นหลังนี้/);
  });

  it('ส่งกลุ่มและลำดับไปกับตัวเลือกทุกหลัง เพื่อให้หน้าเว็บล็อกลำดับได้', async () => {
    meterReadingsService.extractMeterUnit.mockResolvedValue(ocrResult('1210'));

    const res = await service.analyze([fakeFile()], dto);
    const wall = res.results[0].candidates.filter(
      (c) => c.cluster_group_id === 'WALL-206',
    );

    expect(wall.map((c) => c.sequence_index).sort()).toEqual([1, 2]);
  });

  it('ถ่ายสองใบติดกันที่กำแพงเดียวกัน → ต้องไม่เตือนว่า "ยืนที่เดิมกดชัตเตอร์รัว"', async () => {
    // ใบแรกเข้าบ้าน 206/1 ชัด (เลขสูงกว่าเลขตั้งต้นของอีกหลังจนหน่วยพุ่งเกินเพดาน)
    // ใบที่สองเข้าบ้าน 300 ชัด — ทั้งคู่มีบ้านที่ชี้ขาดได้ ด่านถ่ายรัวจึงเป็นตัวเดียวที่เหลือ
    const now = new Date();
    photoMetadataService.read
      .mockReturnValueOnce(atWall(now))
      .mockReturnValueOnce(atWall(new Date(now.getTime() + 3000)));
    meterReadingsService.extractMeterUnit
      .mockResolvedValueOnce(ocrResult('1210'))
      .mockResolvedValueOnce(ocrResult('1205'));

    const res = await service.analyze(
      [fakeFile('a.jpg'), fakeFile('b.jpg')],
      dto,
    );

    for (const item of res.results) {
      expect(item.warnings.join(' ')).not.toMatch(/ชัตเตอร์รัว/);
    }
  });
});
