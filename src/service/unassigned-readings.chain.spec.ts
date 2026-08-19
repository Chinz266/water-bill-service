import { Repository } from 'typeorm';
import { UnassignedReadingsService } from './unassigned-readings.service';
import { UnassignedReadingEntity } from '../entity/unassigned-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import { MeterPhotoService } from './meter-photo.service';
import { BillsService } from './bills.service';
import { ScanBatchService } from './scan-batch.service';

/**
 * มิเตอร์ตัวเดียวกันที่ถ่ายคนละวัน — เชื่อมเป็นไทม์ไลน์
 *
 * ═══ ปัญหาที่แก้ ═══
 *
 * คนเดินจดถ่ายมิเตอร์ตัวเดิมซ้ำคนละวัน (15 ส.ค. ได้ 57, 18 ส.ค. ได้ 90) แล้วทั้งสองใบ
 * ค้างในคิวเป็น "ไม่รู้ว่าบ้านไหน" เหมือนกันทั้งคู่ ทั้งที่พอรู้ว่าใบแรกเป็นบ้านไหน
 * ใบที่สองก็ตอบได้ทันที
 *
 * ═══ สิ่งที่เทสต์ชุดนี้ล็อกไว้ ═══
 *
 * เกณฑ์การเชื่อมต้อง**แน่น** เพราะปลายทางคือคนกดยืนยันว่าเป็นบ้านเดียวกัน แล้วออกบิล
 * เชื่อมผิด = บิลไปออกผิดบ้านโดยที่ทุกอย่างบนจอดูเรียบร้อยดี — ทุกข้อที่ "ไม่รู้"
 * ต้องแปลว่าไม่เชื่อม ไม่ใช่เดาให้
 */

const DAY = 86_400_000;
const BASE = new Date('2026-08-15T09:00:00').getTime();

/** แถวในคิว เท่าที่การเชื่อมไทม์ไลน์ใช้จริง */
const queued = (over: Partial<UnassignedReadingEntity> = {}) =>
  ({
    id: 1,
    villages_id: 1,
    members_id: null,
    blocked_code: null,
    blocked_reason: null,
    meter_unit: 57,
    meter_digits: 2,
    read_confidence: 0.9,
    evidence_photo: 'uploads/meters/a.jpg',
    // ยืนถ่ายที่เดียวกัน — ต่างกันหลักเมตร ซึ่งเป็นเรื่องปกติของ GPS มือถือ
    latitude: 14.9799,
    longitude: 102.0977,
    gps_accuracy_m: 8,
    captured_at: new Date(BASE),
    status: 'Pending',
    note: null,
    create_date: new Date(BASE),
    ...over,
  }) as UnassignedReadingEntity;

describe('UnassignedReadingsService — เชื่อมมิเตอร์ตัวเดียวกันข้ามวัน', () => {
  let service: UnassignedReadingsService;
  let unassignedRepository: Record<string, jest.Mock>;
  let memberRepository: Record<string, jest.Mock>;

  /** ใบที่กำลังดู + กองที่เอามาเทียบ (findAll เรียก find สองครั้ง: แถว แล้วก็กอง) */
  const chainFor = async (rows: UnassignedReadingEntity[], pool = rows) => {
    unassignedRepository.find
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce(pool);

    const result = (await service.findAll({})) as { id: number; chain: any }[];
    return new Map(result.map((row) => [row.id, row.chain]));
  };

  beforeEach(() => {
    unassignedRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    memberRepository = {
      findOneBy: jest.fn(),
      findBy: jest.fn(() =>
        Promise.resolve([
          {
            id: 7,
            house_no: '206/2',
            fname: 'สมชาย',
            lname: 'ใจดี',
            cluster_group_id: 'WALL-206',
            sequence_index: 2,
          },
        ]),
      ),
    };

    service = new UnassignedReadingsService(
      unassignedRepository as unknown as Repository<UnassignedReadingEntity>,
      memberRepository as unknown as Repository<MemberEntity>,
      {} as unknown as MeterPhotoService,
      {} as unknown as BillsService,
      {} as unknown as ScanBatchService,
    );
  });

  it('ใบวันหลังที่เลขมากกว่าและถ่ายที่เดิม → เชื่อมกับใบวันก่อน พร้อมหน่วยที่ใช้ไป', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE) }),
      queued({ id: 12, meter_unit: 90, captured_at: new Date(BASE + 3 * DAY) }),
    ]);

    expect(chains.get(12)).toMatchObject({
      id: 9,
      meter_unit: 57,
      usage_unit: 33,
      days_apart: 3,
    });
    // ใบแรกไม่มีอะไรก่อนหน้า — ต้นโซ่ต้องไม่ถูกเชื่อมย้อนกลับ
    expect(chains.get(9)).toBeNull();
  });

  it('ใบก่อนถูกจับคู่บ้านไปแล้ว → พกบ้านกับตำแหน่งกลุ่มมิเตอร์มาให้คนกดยืนยันได้เลย', async () => {
    const chains = await chainFor([
      queued({ id: 12, meter_unit: 90, captured_at: new Date(BASE + 3 * DAY) }),
      queued({
        id: 9,
        meter_unit: 57,
        captured_at: new Date(BASE),
        status: 'Assigned',
        members_id: 7,
      }),
    ]);

    expect(chains.get(12)).toMatchObject({
      id: 9,
      members_id: 7,
      house_no: '206/2',
      // มิเตอร์กลุ่มนี้ติดกัน 30 ซม. — หน้าเว็บต้องเตือนก่อนให้กดยืนยัน
      cluster_group_id: 'WALL-206',
    });
  });

  it('เลขลดลง → ไม่เชื่อม (มิเตอร์เดินหน้าอย่างเดียว เลขที่ลดลงคือคนละตัว)', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 90, captured_at: new Date(BASE) }),
      queued({ id: 12, meter_unit: 57, captured_at: new Date(BASE + DAY) }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('พิกัดห่างเกินความคลาดเคลื่อนของการวัดสองครั้ง → ไม่เชื่อม', async () => {
    // ~90 ม. — ไกลกว่า CHAIN_NEAR_M (45) ชัดเจน ระดับบ้านถัดไปคนละหลัง
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE) }),
      queued({
        id: 12,
        meter_unit: 90,
        captured_at: new Date(BASE + DAY),
        latitude: 14.9807,
        longitude: 102.0977,
      }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('จำนวนหลักต่างกัน → ไม่เชื่อม (คนละรุ่น = คนละตัวแน่นอน)', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, meter_digits: 2 }),
      queued({
        id: 12,
        meter_unit: 90,
        meter_digits: 5,
        captured_at: new Date(BASE + DAY),
      }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('ห่างกันเกินหนึ่งรอบบิล → ไม่เชื่อม (เลขที่ต่างกันไม่ใช่หน่วยของรอบเดียวกันแล้ว)', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE) }),
      queued({
        id: 12,
        meter_unit: 90,
        captured_at: new Date(BASE + 60 * DAY),
      }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('ไม่มีพิกัด → ไม่เชื่อม ("ไม่รู้" ต้องแปลว่าไม่เชื่อม ไม่ใช่เดาให้)', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE) }),
      queued({
        id: 12,
        meter_unit: 90,
        captured_at: new Date(BASE + DAY),
        latitude: null,
        longitude: null,
      }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('ไม่มีเลขมิเตอร์ (OCR อ่านไม่ออก) → ไม่เชื่อม เพราะเทียบไม่ได้ว่าเดินไปข้างหน้าไหม', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE) }),
      queued({
        id: 12,
        meter_unit: null,
        captured_at: new Date(BASE + DAY),
      }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('มีสองใบก่อนหน้า → เชื่อมกับใบที่ชิดที่สุด ไม่ใช่ต้นโซ่', async () => {
    const chains = await chainFor([
      queued({ id: 7, meter_unit: 40, captured_at: new Date(BASE) }),
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE + 3 * DAY) }),
      queued({ id: 12, meter_unit: 90, captured_at: new Date(BASE + 6 * DAY) }),
    ]);

    expect(chains.get(12)).toMatchObject({ id: 9, usage_unit: 33 });
    expect(chains.get(9)).toMatchObject({ id: 7, usage_unit: 17 });
  });

  it('สองใบก่อนหน้าถ่ายเวลาเดียวกันเป๊ะ → ตอบไม่ได้ว่าใบไหนคือข้อต่อ จึงไม่เชื่อม', async () => {
    const chains = await chainFor([
      queued({ id: 7, meter_unit: 40, captured_at: new Date(BASE) }),
      queued({ id: 8, meter_unit: 41, captured_at: new Date(BASE) }),
      queued({ id: 12, meter_unit: 90, captured_at: new Date(BASE + DAY) }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('เวลาถ่ายเท่ากันเป๊ะกับใบที่ดูอยู่ → ไม่เชื่อม (แยกไม่ออกว่าใบไหนมาก่อน)', async () => {
    const chains = await chainFor([
      queued({ id: 9, meter_unit: 57, captured_at: new Date(BASE) }),
      queued({ id: 12, meter_unit: 90, captured_at: new Date(BASE) }),
    ]);

    expect(chains.get(12)).toBeNull();
  });

  it('EXIF หาย (captured_at เป็น null) → ใช้เวลาที่เข้าคิวแทน ไม่ใช่เลิกเชื่อมทั้งใบ', async () => {
    const chains = await chainFor([
      queued({
        id: 9,
        meter_unit: 57,
        captured_at: null,
        create_date: new Date(BASE),
      }),
      queued({
        id: 12,
        meter_unit: 90,
        captured_at: null,
        create_date: new Date(BASE + DAY),
      }),
    ]);

    expect(chains.get(12)).toMatchObject({ id: 9, usage_unit: 33 });
  });

  it('ใบที่ถูกตีทิ้งต้องไม่ถูกดึงมาเทียบ — คนตัดสินไปแล้วว่าใช้ไม่ได้', async () => {
    await chainFor([queued({ id: 12 })]);

    const calls = unassignedRepository.find.mock.calls as {
      where: { status: { type: string; value: string } };
    }[][];
    const poolQuery = calls[1][0];
    expect(poolQuery.where.status.type).toBe('not');
    expect(poolQuery.where.status.value).toBe('Discarded');
  });
});
