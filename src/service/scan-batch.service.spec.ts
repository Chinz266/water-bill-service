import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ScanBatchService } from './scan-batch.service';
import { BillsService } from './bills.service';
import { MeterReadingsService } from './meter-readings.service';
import { MemberEntity } from '../entity/member.entity';
import { PhotoMetadata, PhotoMetadataService } from './photo-metadata.service';
import { ScanBatchDto } from '../dto/scan-batch.dto';

/**
 * เทสต์การจับคู่ "รูปมิเตอร์ → บ้าน"
 *
 * ตั้งฉากให้เหมือนหมู่บ้านจริง: แต่ละบ้านมีเลขมิเตอร์สะสมห่างกันมาก
 * และมีประวัติการใช้น้ำต่างกัน — ซึ่งเป็นสองอย่างที่ทำให้แยกบ้านออกจากกันได้
 */

type Baseline = Awaited<ReturnType<BillsService['previousUnitsForMembers']>>;

const member = (
  id: number,
  house_no: string,
  coords?: { latitude: number; longitude: number },
): MemberEntity =>
  ({
    id,
    house_no,
    fname: 'สมชาย',
    lname: 'ใจดี',
    ...coords,
  }) as MemberEntity;

/** บ้าน 3 หลัง เลขมิเตอร์ห่างกันชัดเจน เหมือนของจริง */
const MEMBERS = [member(1, '12/3'), member(2, '45'), member(3, '7/1')];

/** รูปที่ไม่มี EXIF เลย (ผ่าน canvas ของหน้าเว็บมาแล้ว) */
const NO_EXIF: PhotoMetadata = {
  has_exif: false,
  captured_at: null,
  latitude: null,
  longitude: null,
};

const baselineOf = (
  rows: Record<
    number,
    { previous_unit: number; usage_history: number[]; already_billed?: boolean }
  >,
): Baseline => {
  const map = new Map();
  for (const [id, row] of Object.entries(rows)) {
    map.set(Number(id), {
      previous_unit: row.previous_unit,
      source: 'bill' as const,
      usage_history: row.usage_history,
      already_billed: row.already_billed ?? false,
    });
  }
  return map as Baseline;
};

const fakeFile = (name = 'meter.jpg') =>
  ({ originalname: name, buffer: Buffer.from('x') }) as Express.Multer.File;

const dto: ScanBatchDto = { billing_month: '08', billing_year: '2026' };

describe('ScanBatchService — จับคู่รูปกับบ้านจากเลขมิเตอร์', () => {
  let service: ScanBatchService;
  let memberRepository: { find: jest.Mock };
  let meterReadingsService: { extractMeterUnit: jest.Mock };
  let billsService: {
    previousUnitsForMembers: jest.Mock;
    readingsOfMembers: jest.Mock;
    learnedMeterLocations: jest.Mock;
  };
  let photoMetadataService: { read: jest.Mock };

  /** ตั้งค่าให้ OCR อ่านได้เลขที่กำหนด (integer_part คือค่าที่ใช้จับคู่) */
  const ocrReturns = (integer_part: string | null, full_reading?: string) => {
    meterReadingsService.extractMeterUnit.mockResolvedValue(
      integer_part === null
        ? {
            success: false,
            read_unit: null,
            integer_part: null,
            decimal_part: null,
            full_reading: null,
            confidence: 0,
            message: 'ไม่พบตัวเลขมิเตอร์',
          }
        : {
            success: true,
            read_unit: full_reading ?? integer_part,
            integer_part,
            decimal_part: null,
            full_reading: full_reading ?? integer_part,
            confidence: 0.93,
            message: 'สกัดค่าตัวเลขสำเร็จ',
          },
    );
  };

  beforeEach(() => {
    memberRepository = { find: jest.fn().mockResolvedValue(MEMBERS) };
    meterReadingsService = { extractMeterUnit: jest.fn() };
    billsService = {
      previousUnitsForMembers: jest.fn(),
      readingsOfMembers: jest.fn().mockResolvedValue([]),
      // ค่าเริ่มต้น = ยังไม่มีพิกัดที่เรียนรู้ไว้ ต้องถอยไปใช้หมุดในทะเบียนแทน
      learnedMeterLocations: jest.fn().mockReturnValue(new Map()),
    };
    // ค่าเริ่มต้น = รูปไม่มี EXIF ซึ่งเป็นสภาพของรูปที่ผ่าน canvas ของหน้าเว็บมา
    photoMetadataService = { read: jest.fn().mockReturnValue(NO_EXIF) };

    service = new ScanBatchService(
      memberRepository as unknown as Repository<MemberEntity>,
      meterReadingsService as unknown as MeterReadingsService,
      billsService as unknown as BillsService,
      photoMetadataService as unknown as PhotoMetadataService,
    );
  });

  describe('เคสปกติ — เลขมิเตอร์ชี้บ้านได้เอง', () => {
    beforeEach(() => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({
          1: { previous_unit: 1250, usage_history: [9, 8, 10] },
          2: { previous_unit: 3891, usage_history: [15, 14, 16] },
          3: { previous_unit: 782, usage_history: [5, 6, 5] },
        }),
      );
    });

    it('เลข 1258 → บ้าน 12/3 (บ้านอื่นติดลบหรือหน่วยพุ่งเกิน)', async () => {
      ocrReturns('1258');

      const res = await service.analyze([fakeFile()], dto);
      const item = res.results[0];

      expect(item.confidence).toBe('high');
      expect(item.suggestion?.house_no).toBe('12/3');
      expect(item.suggestion?.usage_unit).toBe(8);
    });

    it('ตัดบ้านที่ทำให้หน่วยน้ำติดลบทิ้ง (มิเตอร์เดินถอยหลังไม่ได้)', async () => {
      ocrReturns('1258');

      const res = await service.analyze([fakeFile()], dto);

      // บ้าน 45 เลขตั้งต้น 3891 > 1258 จึงต้องไม่โผล่มาเป็นตัวเลือกเลย
      expect(res.results[0].candidates.some((c) => c.house_no === '45')).toBe(
        false,
      );
    });

    it('เลข 3905 → บ้าน 45', async () => {
      ocrReturns('3905');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].suggestion?.house_no).toBe('45');
      expect(res.results[0].suggestion?.usage_unit).toBe(14);
    });
  });

  describe('เคสที่แยกไม่ออก / เสี่ยง', () => {
    it('บ้านสองหลังเลขใกล้กันมาก → ambiguous และไม่เสนอบ้านให้', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({
          1: { previous_unit: 1250, usage_history: [10, 10, 10] },
          2: { previous_unit: 1252, usage_history: [10, 10, 10] },
          3: { previous_unit: 9999, usage_history: [10] },
        }),
      );
      ocrReturns('1260');

      const res = await service.analyze([fakeFile()], dto);
      const item = res.results[0];

      expect(item.confidence).toBe('ambiguous');
      expect(item.suggestion).toBeNull();
      expect(item.reason).toMatch(/แยกจากเลขมิเตอร์อย่างเดียวไม่ได้/);
    });

    it('เลขต่ำกว่าเลขตั้งต้นของทุกบ้าน → none', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({
          1: { previous_unit: 1250, usage_history: [9] },
          2: { previous_unit: 3891, usage_history: [15] },
          3: { previous_unit: 782, usage_history: [5] },
        }),
      );
      ocrReturns('100');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].confidence).toBe('none');
      expect(res.results[0].candidates).toHaveLength(0);
    });

    it('บ้านที่ไม่มีประวัติได้ความมั่นใจแค่ medium (ไม่มีอะไรยืนยัน)', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({
          1: { previous_unit: 0, usage_history: [] },
          2: { previous_unit: 99999, usage_history: [15] },
          3: { previous_unit: 99999, usage_history: [5] },
        }),
      );
      ocrReturns('50');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].confidence).toBe('medium');
      expect(res.results[0].reason).toMatch(/ยังไม่มีประวัติ/);
    });

    it('OCR อ่านไม่ได้ → none และไม่เดาบ้านมั่ว', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({ 1: { previous_unit: 1250, usage_history: [9] } }),
      );
      ocrReturns(null);

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].confidence).toBe('none');
      expect(res.results[0].suggestion).toBeNull();
      expect(res.results[0].reading.meter_unit).toBeNull();
    });
  });

  it('ใช้ integer_part ไม่ใช่ read_unit ที่รวมทศนิยม (กัน WC-1)', async () => {
    billsService.previousUnitsForMembers.mockResolvedValue(
      baselineOf({
        1: { previous_unit: 1250, usage_history: [9, 8, 10] },
        2: { previous_unit: 3891, usage_history: [15] },
        3: { previous_unit: 782, usage_history: [5] },
      }),
    );
    // มิเตอร์แสดง 1258.312 → full_reading = '1258312' ซึ่งถ้าเอามาใช้จะเพี้ยน 1000 เท่า
    ocrReturns('1258', '1258312');

    const res = await service.analyze([fakeFile()], dto);

    expect(res.results[0].reading.meter_unit).toBe(1258);
    expect(res.results[0].suggestion?.usage_unit).toBe(8);
  });

  describe('ข้อมูลจาก EXIF ของรูป', () => {
    // บ้าน 12/3 กับ 45 เลขมิเตอร์ห่างกันแค่ 2 หน่วย → เลขอย่างเดียวแยกไม่ออก
    const AMBIGUOUS_BASELINE = () =>
      baselineOf({
        1: { previous_unit: 1250, usage_history: [10, 10, 10] },
        2: { previous_unit: 1252, usage_history: [10, 10, 10] },
        3: { previous_unit: 9999, usage_history: [10] },
      });

    it('พิกัดในรูปช่วยตัดสินเคสที่เลขมิเตอร์แยกไม่ออกได้', async () => {
      // บ้าน 12/3 อยู่ตรงจุดถ่ายพอดี ส่วนบ้าน 45 อยู่ห่างไปราว 900 เมตร
      memberRepository.find.mockResolvedValue([
        member(1, '12/3', { latitude: 14.98, longitude: 102.0977 }),
        member(2, '45', { latitude: 14.988, longitude: 102.0977 }),
        member(3, '7/1'),
      ]);
      billsService.previousUnitsForMembers.mockResolvedValue(
        AMBIGUOUS_BASELINE(),
      );
      photoMetadataService.read.mockReturnValue({
        has_exif: true,
        captured_at: null,
        latitude: 14.98,
        longitude: 102.0977,
      });
      ocrReturns('1260');

      const res = await service.analyze([fakeFile()], dto);
      const item = res.results[0];

      expect(item.confidence).toBe('medium');
      expect(item.suggestion?.house_no).toBe('12/3');
      expect(item.reason).toMatch(/จุดที่ถ่ายรูปอยู่ห่างบ้าน/);
    });

    it('บ้านสองหลังใกล้กันพอ ๆ กัน → ยังคง ambiguous ไม่เดาให้', async () => {
      // ห่างกันราว 20 เมตร แบบบ้านในหมู่บ้านจริง — GPS แยกไม่ออก
      memberRepository.find.mockResolvedValue([
        member(1, '12/3', { latitude: 14.98, longitude: 102.0977 }),
        member(2, '45', { latitude: 14.98018, longitude: 102.0977 }),
        member(3, '7/1'),
      ]);
      billsService.previousUnitsForMembers.mockResolvedValue(
        AMBIGUOUS_BASELINE(),
      );
      photoMetadataService.read.mockReturnValue({
        has_exif: true,
        captured_at: null,
        latitude: 14.98,
        longitude: 102.0977,
      });
      ocrReturns('1260');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].confidence).toBe('ambiguous');
      expect(res.results[0].suggestion).toBeNull();
    });

    it('รูปไม่มีพิกัด → บอกไปตรง ๆ ว่าใช้ตำแหน่งช่วยตัดไม่ได้', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        AMBIGUOUS_BASELINE(),
      );
      ocrReturns('1260');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].confidence).toBe('ambiguous');
      expect(res.results[0].reason).toMatch(/ไม่มีพิกัดติดมาด้วย/);
      expect(res.results[0].photo_taken.has_exif).toBe(false);
    });

    it('เตือนเมื่อวันที่ถ่ายไม่ตรงกับเดือนที่ออกบิล', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({ 1: { previous_unit: 1250, usage_history: [9, 8, 10] } }),
      );
      memberRepository.find.mockResolvedValue([member(1, '12/3')]);
      photoMetadataService.read.mockReturnValue({
        has_exif: true,
        captured_at: new Date(2026, 2, 15), // มี.ค. แต่ออกบิลเดือน ส.ค.
        latitude: null,
        longitude: null,
      });
      ocrReturns('1258');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].warnings).toEqual([
        expect.stringMatching(/ไม่ใช่เดือนที่กำลังออกบิล/),
      ]);
    });

    it('เตือนเมื่อถ่ายไกลจากบ้านที่เสนอเกิน 150 เมตร', async () => {
      memberRepository.find.mockResolvedValue([
        member(1, '12/3', { latitude: 14.99, longitude: 102.0977 }),
      ]);
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({ 1: { previous_unit: 1250, usage_history: [9, 8, 10] } }),
      );
      photoMetadataService.read.mockReturnValue({
        has_exif: true,
        captured_at: null,
        latitude: 14.98,
        longitude: 102.0977,
      });
      ocrReturns('1258');

      const res = await service.analyze([fakeFile()], dto);

      expect(res.results[0].warnings).toEqual([
        expect.stringMatching(/ห่างจากพิกัดบ้าน 12\/3/),
      ]);
      expect(res.results[0].suggestion?.distance_m).toBeGreaterThan(1000);
    });

    it('พิกัดที่เรียนรู้จากการจดจริง ชนะหมุดในทะเบียน', async () => {
      // ทะเบียนบอกว่าบ้านอยู่ไกลออกไป ~1.1 กม. (หมุดจิ้มผิด/จิ้มกลางหลังคาคนละที่)
      memberRepository.find.mockResolvedValue([
        member(1, '12/3', { latitude: 14.99, longitude: 102.0977 }),
      ]);
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({ 1: { previous_unit: 1250, usage_history: [9, 8, 10] } }),
      );
      // แต่ที่เคยไปยืนถ่ายจริงคือตรงจุดนี้ ซึ่งตรงกับพิกัดในรูปพอดี
      billsService.learnedMeterLocations.mockReturnValue(
        new Map([[1, { latitude: 14.98, longitude: 102.0977, samples: 4 }]]),
      );
      photoMetadataService.read.mockReturnValue({
        has_exif: true,
        captured_at: null,
        latitude: 14.98,
        longitude: 102.0977,
      });
      ocrReturns('1258');

      const res = await service.analyze([fakeFile()], dto);

      // ใช้พิกัดที่เรียนรู้ → ระยะเกือบศูนย์ และต้องไม่มีคำเตือนเรื่องถ่ายไกล
      expect(res.results[0].suggestion?.distance_m).toBeLessThan(5);
      expect(res.results[0].warnings).toHaveLength(0);
    });

    it('อ่าน EXIF จาก buffer ต้นฉบับ ไม่ใช่หลังผ่าน OCR', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({ 1: { previous_unit: 1250, usage_history: [9] } }),
      );
      ocrReturns('1258');

      await service.analyze([fakeFile()], dto);

      expect(photoMetadataService.read).toHaveBeenCalledWith(
        expect.any(Buffer),
      );
    });

    it('vision service ล่ม → ใบนั้นตกเป็น none แต่ยังได้ EXIF และใบอื่นไปต่อ', async () => {
      billsService.previousUnitsForMembers.mockResolvedValue(
        baselineOf({ 1: { previous_unit: 1250, usage_history: [9] } }),
      );
      photoMetadataService.read.mockReturnValue({
        has_exif: true,
        captured_at: new Date(2026, 7, 14),
        latitude: 14.98,
        longitude: 102.0977,
      });
      meterReadingsService.extractMeterUnit
        .mockRejectedValueOnce(new Error('ระบบอ่านมิเตอร์ยังไม่พร้อมใช้งาน'))
        .mockResolvedValueOnce({
          success: true,
          read_unit: '1258',
          integer_part: '1258',
          decimal_part: null,
          full_reading: '1258',
          confidence: 0.9,
          message: 'สกัดค่าตัวเลขสำเร็จ',
        });

      const res = await service.analyze(
        [fakeFile('a.jpg'), fakeFile('b.jpg')],
        dto,
      );

      expect(res.results[0].confidence).toBe('none');
      expect(res.results[0].reason).toMatch(/ยังไม่พร้อมใช้งาน/);
      // EXIF ยังอ่านได้แม้ OCR พัง
      expect(res.results[0].photo_taken.latitude).toBe(14.98);
      // ใบที่สองต้องทำงานต่อได้ตามปกติ
      expect(res.results[1].confidence).toBe('high');
    });
  });

  describe('ด่านกันการใช้งานผิด', () => {
    it('ไม่แนบรูปเลย → 400', async () => {
      await expect(service.analyze([], dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('เกิน 30 รูป → 400 และไม่เรียก OCR สักครั้ง', async () => {
      const tooMany = Array.from({ length: 31 }, () => fakeFile());

      await expect(service.analyze(tooMany, dto)).rejects.toThrow(/ไม่เกิน 30/);
      expect(meterReadingsService.extractMeterUnit).not.toHaveBeenCalled();
    });

    it('ยังไม่มีบ้านในระบบ → 400', async () => {
      memberRepository.find.mockResolvedValue([]);

      await expect(service.analyze([fakeFile()], dto)).rejects.toThrow(
        /ยังไม่มีข้อมูลบ้าน/,
      );
    });
  });

  it('สรุปยอดแยกตามระดับความมั่นใจให้หน้าเว็บ', async () => {
    billsService.previousUnitsForMembers.mockResolvedValue(
      baselineOf({
        1: { previous_unit: 1250, usage_history: [9, 8, 10] },
        2: { previous_unit: 3891, usage_history: [15] },
        3: { previous_unit: 782, usage_history: [5] },
      }),
    );
    ocrReturns('1258');

    const res = await service.analyze(
      [fakeFile('a.jpg'), fakeFile('b.jpg')],
      dto,
    );

    expect(res.total).toBe(2);
    expect(res.summary.high).toBe(2);
    expect(res.results.map((r) => r.filename)).toEqual(['a.jpg', 'b.jpg']);
  });
});
