import { UnprocessableEntityException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { BillEntity } from '../entity/bill.entity';
import { MemberService } from './member.service';
import { BillsService } from './bills.service';
import { MemberEntity } from '../entity/member.entity';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { WaterRateEntity } from '../entity/water-rate.entity';
import { VillageEntity } from '../entity/village.entity';
import { BillArrearsEntity } from '../entity/bill-arrears.entity';
import { MeterEntity } from '../entity/meter.entity';
import { CreateMemberDto } from '../dto/member-create.dto';
import { MeterPhotoService } from './meter-photo.service';
import { ReadingFlagsService } from './reading-flags.service';
import { ReadingLogsService } from './reading-logs.service';

/**
 * กลุ่มมิเตอร์ที่ติดกัน — ด่านตอนกรอก และพิกัดอ้างอิงตอนเปลี่ยนมิเตอร์
 *
 * สองเรื่องนี้อยู่ไฟล์เดียวกันเพราะเป็นคนละครึ่งของปัญหาเดียวกัน:
 * "มิเตอร์ตัวไหนของบ้านไหน เมื่อพิกัดตอบไม่ได้"
 */

// ── ครึ่งแรก: ด่านตอนกรอกตำแหน่งในกลุ่ม ─────────────────────────────

describe('MemberService — กลุ่มมิเตอร์และตำแหน่งในกลุ่ม', () => {
  let service: MemberService;
  let readingLogs: { record: jest.Mock };
  let memberRepository: {
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    merge: jest.Mock;
  };

  /** บ้านที่จองตำแหน่งไว้แล้วในกลุ่ม WALL-206 */
  const occupant = {
    id: 7,
    house_no: '206/1',
    cluster_group_id: 'WALL-206',
    sequence_index: 1,
  } as MemberEntity;

  beforeEach(() => {
    memberRepository = {
      // ตอบเฉพาะคิวรีที่ถามหา "ใครอยู่ตำแหน่งนี้" — คิวรีอื่น (บ้านเลขที่ซ้ำ) คืน null
      findOneBy: jest.fn((where: Record<string, unknown>) => {
        if (
          where.cluster_group_id === occupant.cluster_group_id &&
          where.sequence_index === occupant.sequence_index
        ) {
          return Promise.resolve(occupant);
        }
        return Promise.resolve(null);
      }),
      create: jest.fn((v: unknown) => v),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
      merge: jest.fn((target: object, patch: object) =>
        Object.assign({}, target, patch),
      ),
    };

    readingLogs = { record: jest.fn().mockResolvedValue({}) };

    service = new MemberService(
      memberRepository as unknown as Repository<MemberEntity>,
      {} as Repository<MeterReadingEntity>,
      {} as unknown as MeterPhotoService,
      readingLogs as unknown as ReadingLogsService,
    );
  });

  const dto = (overrides: Partial<CreateMemberDto> = {}) => ({
    fname: 'สมชาย',
    lname: 'ใจดี',
    house_no: '206/9',
    villages_id: 1,
    create_by: 1,
    ...overrides,
  });

  it('บ้านเดี่ยวไม่กรอกอะไรเลย → บันทึกได้ และเก็บเป็น NULL ทั้งคู่', async () => {
    const saved = await service.create(dto());

    expect(saved).toEqual(
      expect.objectContaining({
        cluster_group_id: null,
        sequence_index: null,
      }),
    );
  });

  it('ช่องว่างจากฟอร์มต้องกลายเป็น NULL ไม่ใช่สตริงว่าง', async () => {
    // '' เป็นค่าที่มีจริงในสายตา UNIQUE index — บ้านเดี่ยวหลังที่สองจะชนกันทันที
    const saved = await service.create(
      dto({ cluster_group_id: '  ', sequence_index: null }),
    );

    expect(saved).toEqual(
      expect.objectContaining({ cluster_group_id: null, sequence_index: null }),
    );
  });

  it('อยู่ในกลุ่มแต่ไม่ระบุตำแหน่ง → ปฏิเสธ', async () => {
    // สภาพนี้แย่กว่าไม่ประกาศกลุ่มเลย เพราะ ScanBatchService จะปิดการใช้พิกัด
    // แล้วบอกให้ไล่จดตามลำดับที่ไม่มีอยู่จริง
    await expect(
      service.create(dto({ cluster_group_id: 'WALL-206' })),
    ).rejects.toThrow(/ตำแหน่งในกลุ่ม/);
  });

  it('ระบุตำแหน่งแต่ไม่มีกลุ่ม → ปฏิเสธ', async () => {
    await expect(service.create(dto({ sequence_index: 2 }))).rejects.toThrow(
      /กลุ่มมิเตอร์/,
    );
  });

  it('ตำแหน่งต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป', async () => {
    await expect(
      service.create(dto({ cluster_group_id: 'WALL-206', sequence_index: 0 })),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('ตำแหน่งซ้ำกับบ้านหลังอื่นในกลุ่มเดียวกัน → ปฏิเสธ พร้อมบอกว่าชนกับบ้านไหน', async () => {
    // ต้องบอกบ้านเลขที่ ไม่ใช่ปล่อย ER_DUP_ENTRY ของ MySQL หลุดออกไปเป็น 500
    await expect(
      service.create(dto({ cluster_group_id: 'WALL-206', sequence_index: 1 })),
    ).rejects.toThrow(/206\/1/);

    expect(memberRepository.save).not.toHaveBeenCalled();
  });

  it('ตำแหน่งว่างในกลุ่มเดียวกัน → บันทึกได้', async () => {
    await expect(
      service.create(dto({ cluster_group_id: 'WALL-206', sequence_index: 3 })),
    ).resolves.toEqual(
      expect.objectContaining({
        cluster_group_id: 'WALL-206',
        sequence_index: 3,
      }),
    );
  });

  it('แก้บ้านหลังเดิมโดยคงตำแหน่งเดิมไว้ → ต้องไม่ฟ้องว่าซ้ำกับตัวเอง', async () => {
    memberRepository.findOneBy = jest.fn((where: Record<string, unknown>) => {
      if (where.id === occupant.id) return Promise.resolve(occupant);
      if (
        where.cluster_group_id === occupant.cluster_group_id &&
        where.sequence_index === occupant.sequence_index
      ) {
        return Promise.resolve(occupant);
      }
      return Promise.resolve(null);
    });

    await expect(
      service.update({
        id: occupant.id,
        cluster_group_id: 'WALL-206',
        sequence_index: 1,
      }),
    ).resolves.toBeDefined();
  });

  it('ล้างกลุ่มทิ้ง → ตำแหน่งต้องถูกล้างตามไปด้วย', async () => {
    memberRepository.findOneBy = jest.fn((where: Record<string, unknown>) =>
      Promise.resolve(where.id === occupant.id ? occupant : null),
    );

    const saved = await service.update({
      id: occupant.id,
      cluster_group_id: null,
    });

    expect(saved).toEqual(
      expect.objectContaining({ cluster_group_id: null, sequence_index: null }),
    );
  });
});

// ── ครึ่งหลัง: พิกัดอ้างอิงต้องตามมิเตอร์ตัวที่ใช้อยู่ ──────────────────

describe('BillsService.learnedMeterLocations — ตัดการจดของมิเตอร์ตัวที่ถอดไปแล้ว', () => {
  let service: BillsService;

  beforeEach(() => {
    service = new BillsService(
      {} as Repository<BillEntity>,
      {} as Repository<WaterRateEntity>,
      {} as Repository<MeterReadingEntity>,
      {} as Repository<MemberEntity>,
      {} as Repository<VillageEntity>,
      {} as unknown as MeterPhotoService,
      {} as Repository<BillArrearsEntity>,
      {} as Repository<MeterEntity>,
      {} as unknown as ReadingFlagsService,
      {} as unknown as ReadingLogsService,
    );
  });

  /** 1e-4 องศา ≈ 11 เมตร — ไกลพอให้เห็นว่า median ขยับจริงไหม */
  const at = (
    members_id: number,
    meters_id: number | null,
    offsetDeg: number,
  ) =>
    ({
      members_id,
      meters_id,
      latitude: 14.9799,
      longitude: 102.097771 + offsetDeg,
    }) as MeterReadingEntity;

  it('มิเตอร์ตัวเก่าจดไว้เยอะกว่า แต่พิกัดอ้างอิงต้องเป็นของตัวใหม่', () => {
    // ของเดิม median จะยอมขยับก็ต่อเมื่อจุดใหม่มากกว่าครึ่ง — บ้านที่จดมา 6 ครั้ง
    // ที่จุดเก่า ต้องจดที่จุดใหม่อีก 7 ครั้งกว่าระบบจะยอมรับว่ามิเตอร์ย้ายแล้ว
    const readings = [
      at(1, 10, 0),
      at(1, 10, 0),
      at(1, 10, 0),
      at(1, 10, 0),
      at(1, 10, 0),
      at(1, 10, 0),
      at(1, 11, 0.0001),
      at(1, 11, 0.0001),
    ];

    const learned = service.learnedMeterLocations(readings);

    expect(learned.get(1)?.longitude).toBeCloseTo(102.097871, 6);
    expect(learned.get(1)?.samples).toBe(2);
  });

  it('แถวที่ meters_id เป็น NULL ต้องเก็บไว้ — "ไม่รู้ว่าตัวไหน" ไม่ใช่ "คนละตัว"', () => {
    // การจดก่อนมีทะเบียนมิเตอร์เป็น NULL ทั้งหมด ตัดทิ้งจะเสียตัวอย่างของบ้าน
    // ที่ไม่เคยเปลี่ยนมิเตอร์เลย ทั้งที่ข้อมูลยังใช้ได้อยู่
    const readings = [at(2, null, 0), at(2, null, 0), at(2, 20, 0)];

    expect(service.learnedMeterLocations(readings).get(2)?.samples).toBe(3);
  });

  it('บ้านที่ไม่เคยมี meters_id เลย ต้องทำงานเหมือนเดิมทุกประการ', () => {
    const readings = [at(3, null, 0), at(3, null, 0.0001)];

    expect(service.learnedMeterLocations(readings).get(3)?.samples).toBe(2);
  });

  it('เหลือตัวอย่างของมิเตอร์ตัวใหม่ครั้งเดียว → ยังไม่พอเป็นจุดอ้างอิง', () => {
    // ครั้งเดียวแยกไม่ออกว่าเป็นตำแหน่งจริงหรือเป็นครั้งที่ GPS เพี้ยนพอดี
    const readings = [at(4, 40, 0), at(4, 40, 0), at(4, 41, 0.0001)];

    expect(service.learnedMeterLocations(readings).has(4)).toBe(false);
  });
});
