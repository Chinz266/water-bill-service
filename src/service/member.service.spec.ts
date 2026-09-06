import { UnprocessableEntityException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { MemberService } from './member.service';
import { MemberEntity } from '../entity/member.entity';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { CreateMemberDto } from '../dto/member-create.dto';
import { RegisterMemberOnsiteDto } from '../dto/member-onsite.dto';
import { MeterPhotoService } from './meter-photo.service';
import { ReadingLogsService } from './reading-logs.service';

/**
 * เทสต์ด่านตรวจพิกัดบ้าน
 *
 * assertCoordinates() ทำงานก่อนแตะฐานข้อมูล เคสที่ต้องถูกปฏิเสธจึง mock เปล่า ๆ ได้
 *
 * ที่ต้องมีด่านนี้เพราะคอลัมน์เป็น decimal ที่มีที่พอดีกับช่วงจริง
 * ค่าที่เกินช่วง (พิมพ์ผิด หรือสลับ lat/lng กัน) จะกลายเป็น error 1264 ของ MySQL
 * ซึ่งโผล่ออกไปเป็น 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง
 */
describe('MemberService — ด่านตรวจพิกัด', () => {
  let service: MemberService;
  let memberRepository: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let meterReadingRepository: { findBy: jest.Mock };
  let photoService: { save: jest.Mock; remove: jest.Mock };
  let readingLogs: { record: jest.Mock };

  beforeEach(() => {
    memberRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
      manager: {
        transaction: jest.fn((cb: (m: Record<string, jest.Mock>) => unknown) =>
          Promise.resolve(
            cb({
              create: jest.fn((_entity: unknown, value: unknown) => value),
              save: jest.fn((value: Record<string, unknown>) =>
                Promise.resolve({ id: 42, ...value }),
              ),
              delete: jest.fn().mockResolvedValue({ affected: 1 }),
            }),
          ),
        ),
      },
    };
    meterReadingRepository = { findBy: jest.fn().mockResolvedValue([]) };
    photoService = {
      save: jest.fn().mockResolvedValue('/uploads/meters/x.jpg'),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    readingLogs = { record: jest.fn().mockResolvedValue({}) };

    service = new MemberService(
      memberRepository as unknown as Repository<MemberEntity>,
      meterReadingRepository as unknown as Repository<MeterReadingEntity>,
      photoService as unknown as MeterPhotoService,
      readingLogs as unknown as ReadingLogsService,
    );
  });

  const dto = (overrides: Partial<CreateMemberDto> = {}) => ({
    fname: 'สมชาย',
    lname: 'ใจดี',
    house_no: '99/9',
    villages_id: 1,
    create_by: 1,
    ...overrides,
  });

  it('ปฏิเสธลองจิจูดที่เกินช่วง ±180', async () => {
    await expect(service.create(dto({ longitude: 200 }))).rejects.toThrow(
      UnprocessableEntityException,
    );
    expect(memberRepository.save).not.toHaveBeenCalled();
  });

  it('ปฏิเสธละติจูดที่เกินช่วง ±90 (เคสสลับ lat/lng กัน)', async () => {
    // 102.09 เป็นลองจิจูดของโคราช ถ้ามาโผล่ในช่อง latitude แปลว่ากรอกสลับกัน
    await expect(service.create(dto({ latitude: 102.09 }))).rejects.toThrow(
      /ละติจูด/,
    );
  });

  it('ปฏิเสธค่าที่ไม่ใช่ตัวเลข', async () => {
    await expect(
      service.create(dto({ longitude: 'ไม่รู้' as unknown as number })),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('ยอมรับพิกัดจริงของไทย (ลองจิจูด 3 หลัก — เคสที่ decimal(10,8) เดิมเก็บไม่ได้)', async () => {
    await expect(
      service.create(dto({ latitude: 14.9799, longitude: 102.097771 })),
    ).resolves.toEqual(
      expect.objectContaining({ latitude: 14.9799, longitude: 102.097771 }),
    );
  });

  it('ไม่กรอกพิกัดก็บันทึกได้ (คอลัมน์เป็น nullable)', async () => {
    await expect(service.create(dto())).resolves.toBeDefined();
  });

  describe('ลงทะเบียนแบบยืนที่มิเตอร์', () => {
    const onsite = (overrides: Partial<RegisterMemberOnsiteDto> = {}) =>
      ({
        fname: 'สมชาย',
        lname: 'ใจดี',
        house_no: '99/9',
        villages_id: 1,
        create_by: 1,
        latitude: 14.9799,
        longitude: 102.097771,
        gps_accuracy_m: 12,
        initial_meter_unit: 1250,
        ...overrides,
      }) as RegisterMemberOnsiteDto;

    it('สร้างทั้งบ้านและการจดครั้งแรกพร้อมพิกัดเดียวกัน', async () => {
      const result = await service.registerOnsite(onsite());

      expect(result.member.house_no).toBe('99/9');
      // เลขตั้งต้นต้องถูกบันทึกเป็นการจดครั้งแรก ไม่งั้นบิลใบแรกจะคิดจาก 0
      expect(result.initial_reading.meter_unit).toBe(1250);
      // พิกัดต้องลงทั้งสองที่ — ทะเบียนใช้โชว์ ส่วนของการจดใช้เรียนรู้ตำแหน่งมิเตอร์
      expect(result.initial_reading.latitude).toBe(14.9799);
      expect(result.member.latitude).toBe(14.9799);
      expect(result.initial_reading.gps_accuracy_m).toBe(12);
    });

    it('ปฏิเสธเมื่อสัญญาณ GPS ยังไม่นิ่ง (เกิน 20 เมตร)', async () => {
      await expect(
        service.registerOnsite(onsite({ gps_accuracy_m: 120 })),
      ).rejects.toThrow(/สัญญาณ GPS ยังไม่นิ่ง/);
      expect(memberRepository.manager.transaction).not.toHaveBeenCalled();
    });

    // ล็อกเกณฑ์ใหม่ไว้: 35 ม. เคยผ่านสมัยเกณฑ์ 50 แต่รวมกับความคลาดเคลื่อน
    // ตอนจด (~30 ม.) แล้วเกิน GPS_NEAR_M จนใช้ตัดสินอะไรไม่ได้
    it('ปฏิเสธ accuracy 35 เมตร ที่เคยผ่านสมัยเกณฑ์ 50', async () => {
      await expect(
        service.registerOnsite(onsite({ gps_accuracy_m: 35 })),
      ).rejects.toThrow(/ต้องไม่เกิน 20 เมตร/);
    });

    it('ยอมรับ accuracy ที่ขอบเกณฑ์พอดี (20 เมตร)', async () => {
      await expect(
        service.registerOnsite(onsite({ gps_accuracy_m: 20 })),
      ).resolves.toBeDefined();
    });

    it('ปฏิเสธเลขมิเตอร์ตั้งต้นที่ติดลบ', async () => {
      await expect(
        service.registerOnsite(onsite({ initial_meter_unit: -5 })),
      ).rejects.toThrow(/จำนวนเต็มไม่ติดลบ/);
    });

    it('ปฏิเสธบ้านเลขที่ซ้ำ', async () => {
      memberRepository.findOneBy.mockResolvedValue({ id: 7 });

      await expect(service.registerOnsite(onsite())).rejects.toThrow(
        /มีอยู่ในระบบแล้ว/,
      );
    });

    it('ลงทะเบียนล้ม → ลบรูปที่เพิ่งเขียนทิ้ง ไม่ทิ้งไฟล์กำพร้า', async () => {
      memberRepository.manager.transaction.mockRejectedValue(
        new Error('DB ล้ม'),
      );

      await expect(
        service.registerOnsite(
          onsite({ meter_photo: 'data:image/jpeg;base64,x' }),
        ),
      ).rejects.toThrow('DB ล้ม');

      expect(photoService.remove).toHaveBeenCalledWith('/uploads/meters/x.jpg');
    });
  });

  // ทางลบบิลเก็บกวาดไฟล์รูปให้อยู่แล้ว แต่ทางลบบ้านเคยลบแค่แถวในตาราง
  // รูปมิเตอร์ทุกเดือนของบ้านนั้นจึงค้างบนดิสก์ถาวรโดยไม่มีอะไรอ้างถึงอีกเลย
  describe('ลบลูกบ้าน', () => {
    it('ลบรูปมิเตอร์ทุกใบของบ้านหลังนั้นออกจากดิสก์ด้วย', async () => {
      memberRepository.findOneBy.mockResolvedValue({ id: 5 });
      meterReadingRepository.findBy.mockResolvedValue([
        { id: 1, evidence_photo: '/uploads/meters/a.jpg' },
        { id: 2, evidence_photo: '/uploads/meters/b.jpg' },
        { id: 3, evidence_photo: null }, // จดโดยไม่ได้ถ่ายรูป
      ]);

      await service.remove({ id: 5 });

      expect(photoService.remove).toHaveBeenCalledWith('/uploads/meters/a.jpg');
      expect(photoService.remove).toHaveBeenCalledWith('/uploads/meters/b.jpg');
    });

    it('ลบไฟล์หลัง commit เท่านั้น — ทรานแซกชันล้มแล้วรูปต้องยังอยู่ครบ', async () => {
      memberRepository.findOneBy.mockResolvedValue({ id: 5 });
      meterReadingRepository.findBy.mockResolvedValue([
        { id: 1, evidence_photo: '/uploads/meters/a.jpg' },
      ]);
      memberRepository.manager.transaction.mockRejectedValue(
        new Error('DB ล้ม'),
      );

      await expect(service.remove({ id: 5 })).rejects.toThrow('DB ล้ม');

      expect(photoService.remove).not.toHaveBeenCalled();
    });
  });
});
