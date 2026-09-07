import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { UnassignedReadingsService } from './unassigned-readings.service';
import { UnassignedReadingEntity } from '../entity/unassigned-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { MeterPhotoService } from './meter-photo.service';
import { BillsService } from './bills.service';
import { ScanBatchService } from './scan-batch.service';

/**
 * คิว "รอการตรวจสอบ" — รูปที่รู้บ้านแล้ว แต่ด่านตีกลับ
 *
 * ═══ ทำไมต้องมีทางเลือกนี้ ═══
 *
 * ด่านหน่วยพุ่ง/เลขต่ำกว่าเดือนก่อน/จดสลับตัว ตีกลับด้วย 409 แล้วให้คนหน้างานตัดสินเอง
 * ว่าจะกดยืนยันข้ามไหม — แต่คนที่ยืนกลางแดดกับมิเตอร์อีก 40 ตัวที่ยังไม่ได้จด จะกดผ่าน
 * เกือบทุกครั้ง ซึ่งทำให้ด่านทั้งหมดกลายเป็นพิธีกรรม
 *
 * เทสต์ชุดนี้ล็อกสิ่งที่ทำให้ทางเลือกที่สาม (ฝากไว้ให้คนมีเวลาตรวจ) ใช้งานได้จริง:
 * บ้านที่คนหน้างานเลือกไว้ต้องเดินทางไปถึงคนตรวจ พร้อมเหตุผลที่ถูกตีกลับ
 * และตอนอนุมัติต้องวิ่งผ่าน createFromScan ตัวเดิม ไม่ใช่เขียนบิลลัดด่าน
 */
describe('UnassignedReadingsService — คิวรอการตรวจสอบ', () => {
  let service: UnassignedReadingsService;
  let unassignedRepository: Record<string, jest.Mock>;
  let memberRepository: Record<string, jest.Mock>;
  let meterPhotoService: Record<string, jest.Mock>;
  let billsService: Record<string, jest.Mock>;
  let scanBatchService: Record<string, jest.Mock>;

  const member = {
    id: 7,
    house_no: '206/2',
    fname: 'สมชาย',
    lname: 'ใจดี',
    villages_id: 1,
    cluster_group_id: 'WALL-206',
    sequence_index: 2,
  };

  /** แถวในคิวที่เข้ามาเพราะด่านหน่วยพุ่ง (บ้านรู้แล้ว) */
  const blockedRow = {
    id: 55,
    villages_id: 1,
    members_id: member.id,
    blocked_code: 'HIGH_USAGE',
    blocked_reason:
      'หน่วยน้ำที่คำนวณได้ (420 หน่วย) สูงกว่าที่บ้านหลังนี้ใช้ตามปกติมาก',
    meter_unit: 1670,
    meter_digits: 4,
    read_confidence: 0.93,
    evidence_photo: 'uploads/meters/blocked.jpg',
    latitude: 14.9799,
    longitude: 102.0977,
    gps_accuracy_m: 8,
    captured_at: new Date('2026-08-14T10:23:45'),
    status: 'Pending',
    note: null,
  };

  beforeEach(() => {
    unassignedRepository = {
      create: jest.fn((row: unknown) => row),
      save: jest.fn((row: unknown) =>
        Promise.resolve({ id: 99, ...(row as object) }),
      ),
      // findOneWithCandidates เรียก find() หากองมาเชื่อมไทม์ไลน์ด้วย — ไม่มีของค้างอื่น
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    memberRepository = {
      findOneBy: jest.fn(({ id }: { id: number }) =>
        Promise.resolve(id === member.id ? member : null),
      ),
    };
    meterPhotoService = {
      save: jest.fn(() => Promise.resolve('uploads/meters/new.jpg')),
      remove: jest.fn(() => Promise.resolve()),
      toDataUrl: jest.fn(() => Promise.resolve('data:image/jpeg;base64,AAAA')),
    };
    billsService = {
      createFromScan: jest.fn(() =>
        Promise.resolve({ id: 1, meter_readings_id: 500 }),
      ),
      previousUnitsForMembers: jest.fn(() =>
        Promise.resolve(new Map([[member.id, { previous_unit: 1250 }]])),
      ),
    };
    scanBatchService = {
      candidatesForUnit: jest.fn(() => Promise.resolve([])),
    };

    service = new UnassignedReadingsService(
      unassignedRepository as unknown as Repository<UnassignedReadingEntity>,
      memberRepository as unknown as Repository<MemberEntity>,
      meterPhotoService as unknown as MeterPhotoService,
      billsService as unknown as BillsService,
      scanBatchService as unknown as ScanBatchService,
    );
  });

  describe('ตอนฝากเข้าคิว', () => {
    it('เก็บบ้านที่คนหน้างานเลือกไว้ พร้อมรหัสและข้อความของด่านที่ตีกลับ', async () => {
      await service.create({
        meter_photo: 'data:image/jpeg;base64,AAAA',
        members_id: member.id,
        blocked_code: 'HIGH_USAGE',
        blocked_reason: 'หน่วยน้ำสูงกว่าปกติมาก',
        meter_unit: 1670,
        villages_id: 1,
      });

      expect(unassignedRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          members_id: member.id,
          blocked_code: 'HIGH_USAGE',
          blocked_reason: 'หน่วยน้ำสูงกว่าปกติมาก',
          status: 'Pending',
        }),
      );
    });

    it('รูปกำพร้าที่ยังไม่รู้ว่าบ้านไหน → ทั้งสามคอลัมน์เป็น NULL เหมือนเดิม', async () => {
      await service.create({ meter_photo: 'data:image/jpeg;base64,AAAA' });

      expect(unassignedRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          members_id: null,
          blocked_code: null,
          blocked_reason: null,
        }),
      );
    });

    it('บ้านที่ส่งมาไม่มีอยู่จริง → ตีกลับตั้งแต่ตอนนี้ และต้องไม่เขียนไฟล์รูปทิ้งไว้', async () => {
      // ถ้าปล่อยผ่าน คนตรวจจะไปเจอ error ตอนกดอนุมัติ ในวันที่คนหน้างานเดินออกจากพื้นที่ไปแล้ว
      await expect(
        service.create({
          meter_photo: 'data:image/jpeg;base64,AAAA',
          members_id: 999,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(meterPhotoService.save).not.toHaveBeenCalled();
      expect(unassignedRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('ตอนคนตรวจเปิดดู', () => {
    it('แนบบ้านที่คนหน้างานเลือกไว้ พร้อมเลขตั้งต้นและหน่วยที่จะได้', async () => {
      unassignedRepository.findOne.mockResolvedValue(blockedRow);

      const result = (await service.findOneWithCandidates(
        55,
        '08',
        '2026',
      )) as {
        suggested: {
          house_no: string;
          previous_unit: number;
          usage_unit: number;
        };
      };

      expect(result.suggested).toMatchObject({
        members_id: member.id,
        house_no: '206/2',
        previous_unit: 1250,
        usage_unit: 420,
        // ตำแหน่งในกลุ่มมิเตอร์ที่ติดกัน — คนตรวจต้องเห็นว่าเป็นตัวไหนบนกำแพง
        cluster_group_id: 'WALL-206',
        sequence_index: 2,
      });
    });

    it('รูปกำพร้าแท้ ๆ → ไม่มีบ้านที่เสนอไว้ ให้เลือกจาก candidates ตามเดิม', async () => {
      unassignedRepository.findOne.mockResolvedValue({
        ...blockedRow,
        members_id: null,
        blocked_code: null,
      });

      const result = (await service.findOneWithCandidates(
        55,
        '08',
        '2026',
      )) as {
        suggested: unknown;
      };

      expect(result.suggested).toBeNull();
    });
  });

  describe('ตอนอนุมัติ', () => {
    beforeEach(() =>
      unassignedRepository.findOne.mockResolvedValue(blockedRow),
    );

    it('ไม่ได้เลือกบ้านใหม่ → ยืนตามบ้านที่คนหน้างานเลือกไว้', async () => {
      await service.assign(55, {
        water_rates_id: 1,
        billing_month: '08',
        billing_year: '2026',
        confirm_high_usage: true,
      });

      expect(billsService.createFromScan).toHaveBeenCalledWith(
        expect.objectContaining({
          members_id: member.id,
          confirm_high_usage: true,
        }),
      );
    });

    it('คนตรวจเปลี่ยนบ้าน → บ้านที่เลือกใหม่ชนะเสมอ (เหตุผลที่เข้าคิวคืออาจจดสลับบ้าน)', async () => {
      await service.assign(55, {
        members_id: 12,
        water_rates_id: 1,
        billing_month: '08',
        billing_year: '2026',
      });

      expect(billsService.createFromScan).toHaveBeenCalledWith(
        expect.objectContaining({ members_id: 12 }),
      );
    });

    it('ไม่มีบ้านทั้งสองทาง → บอกตรง ๆ ว่ายังออกบิลให้ใครไม่ได้', async () => {
      unassignedRepository.findOne.mockResolvedValue({
        ...blockedRow,
        members_id: null,
      });

      await expect(
        service.assign(55, {
          water_rates_id: 1,
          billing_month: '08',
          billing_year: '2026',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(billsService.createFromScan).not.toHaveBeenCalled();
    });

    it('อนุมัติแล้วต้องวิ่งผ่าน createFromScan ตัวเดิม — ด่านที่เหลือยังต้องทำงานครบ', async () => {
      await service.assign(55, {
        water_rates_id: 1,
        billing_month: '08',
        billing_year: '2026',
      });

      // ส่งรูปเป็น data URL เข้าเส้นทางเดิม ไม่ใช่ยัด path ตรง ๆ ซึ่งจะข้ามชั้นตรวจไฟล์
      expect(billsService.createFromScan).toHaveBeenCalledWith(
        expect.objectContaining({ meter_photo: 'data:image/jpeg;base64,AAAA' }),
      );
      expect(unassignedRepository.update).toHaveBeenCalledWith(
        55,
        expect.objectContaining({
          status: 'Assigned',
          resolved_reading_id: 500,
        }),
      );
    });
  });
});
