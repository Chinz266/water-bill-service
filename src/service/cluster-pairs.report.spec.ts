import { Repository } from 'typeorm';
import { ScanBatchService } from './scan-batch.service';
import { BillsService } from './bills.service';
import { MeterReadingsService } from './meter-readings.service';
import { MemberEntity } from '../entity/member.entity';
import { VillageEntity } from '../entity/village.entity';
import { PhotoMetadata, PhotoMetadataService } from './photo-metadata.service';
import { LatLng, RelativeDirectionUtil } from './relative-direction';
import { ScanBatchDto } from '../dto/scan-batch.dto';

/**
 * รายงานผลทดสอบ: มิเตอร์ 10 คู่ที่อยู่ใกล้กัน
 *
 * ตอบสองคำถามต่อหนึ่งคู่
 *
 *   ก. **บ้านหลังไหน** — ระบบชี้บ้านถูกไหมเมื่อเลขมิเตอร์ของสองหลังแยกกันไม่ขาด
 *   ข. **ตัวซ้ายหรือตัวขวา** — ถ้าใช้พิกัดตอบ จะถูกกี่เปอร์เซ็นต์
 *
 * ═══ ส่วน ก. ═══
 *
 * เรียก ScanBatchService.analyze() ตัวจริง ไม่ได้จำลองตรรกะใหม่
 * ทุกคู่ตั้งเลขตั้งต้นให้ห่างกัน 5 หน่วย ซึ่งเป็นจุดที่คะแนนจากหน่วยน้ำแยกสองหลัง
 * ไม่ขาด (1.000 ต่อ 0.667 ยังไม่ถึงสองเท่า) — คือจุดที่ระบบต้องตัดสินใจว่า
 * จะหันไปพึ่งพิกัดหรือไม่
 *
 * ═══ ส่วน ข. — ออกแบบตามการเก็บข้อมูลจริงหน้างาน ═══
 *
 * หนึ่ง "รอบเก็บข้อมูล" = ถ่ายมิเตอร์ตัวซ้าย 10 รูป และตัวขวา 10 รูป
 * แล้วจับคู่แบบไขว้ทุกความเป็นไปได้ 10 × 10 = 100 คู่เทียบต่อหนึ่งคู่มิเตอร์
 *
 *   รูปซ้ายใบที่ 1 เทียบกับรูปขวาทั้ง 10 ใบ → ตอบถูกกี่ใบ
 *   รูปซ้ายใบที่ 2 เทียบกับรูปขวาทั้ง 10 ใบ → ตอบถูกกี่ใบ
 *   ... วนจนครบรูปซ้ายทั้ง 10 ใบ
 *
 * คำตอบที่ถูกคือ 'ขวา' เสมอ เพราะวางมิเตอร์ตัวที่สองไว้ทางตะวันออกของตัวแรกทุกคู่
 *
 * ทำซ้ำ SESSIONS รอบด้วยเมล็ดสุ่มต่างกัน เพื่อไม่ให้ตัวเลขสรุปขึ้นกับรอบเดียวที่บังเอิญดี
 * และพิมพ์เมทริกซ์ของรอบแรกออกมาให้เห็นของจริง
 *
 * นอกจากนี้ยังเทียบสองวิธีใช้ข้อมูลชุดเดียวกัน:
 *   - **รูปเดี่ยว** — เอารูปหนึ่งใบเทียบอีกใบ (คือสิ่งที่เกิดตอนจดจริงครั้งเดียว)
 *   - **ค่ากลาง 10 รูป** — ยุบ 10 รูปเป็นจุดเดียวด้วยมัธยฐานก่อนเทียบ
 *     (คือสิ่งที่ learnedMeterLocations() ทำเมื่อมีประวัติสะสม)
 *
 * σ = 4 ม.  → ที่โล่ง จับดาวเทียมได้ดี
 * σ = 15 ม. → ใต้ชายคา / ระหว่างตึกแถว
 *
 * รันด้วย: npm test -- cluster-pairs
 */

// ── ฉากทดสอบ ────────────────────────────────────────────────────────

/** จุดอ้างอิงกลางหมู่บ้าน (นครราชสีมา) */
const BASE_LAT = 14.9799;
const BASE_LNG = 102.097771;

const METERS_PER_DEG_LAT = 111_320;
const metersPerDegLng = (lat: number) =>
  METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** เลื่อนไปทางตะวันออกกี่เมตร → ได้ลองจิจูดใหม่ */
const eastOf = (lng: number, meters: number) =>
  lng + meters / metersPerDegLng(BASE_LAT);

/** จำนวนรูปต่อมิเตอร์หนึ่งตัวในหนึ่งรอบเก็บข้อมูล */
const PHOTOS_PER_METER = 10;

/** จำนวนรอบเก็บข้อมูลที่ทำซ้ำเพื่อให้ตัวเลขสรุปนิ่ง */
const SESSIONS = 200;

interface Pair {
  code: string;
  /** ระยะห่างระหว่างมิเตอร์สองตัวในคู่ (เมตร) */
  gap_m: number;
  /** ติดกันบนกำแพงเดียวกันจนต้องประกาศเป็นกลุ่มไหม */
  cluster: boolean;
  note: string;
}

/**
 * 10 คู่ ไล่ระยะจากติดกำแพงจนถึงคนละฝั่งซอย
 * สามคู่แรกประกาศเป็นกลุ่มมิเตอร์ ที่เหลือเป็นบ้านเดี่ยวที่ยังใช้พิกัดได้ตามกติกา
 */
const PAIRS: Pair[] = [
  { code: 'P01', gap_m: 0.3, cluster: true, note: 'ติดกันบนกำแพงเดียวกัน' },
  { code: 'P02', gap_m: 1, cluster: true, note: 'กำแพงเดียวกัน เว้นช่อง' },
  { code: 'P03', gap_m: 2, cluster: true, note: 'กำแพงเดียวกัน คนละเสา' },
  { code: 'P04', gap_m: 3, cluster: false, note: 'ทาวน์โฮมชิดกัน' },
  { code: 'P05', gap_m: 5, cluster: false, note: 'ทาวน์โฮมทั่วไป' },
  { code: 'P06', gap_m: 7, cluster: false, note: 'ทาวน์โฮมหน้ากว้าง' },
  { code: 'P07', gap_m: 12, cluster: false, note: 'บ้านแฝด' },
  { code: 'P08', gap_m: 20, cluster: false, note: 'บ้านเดี่ยวติดกัน' },
  { code: 'P09', gap_m: 40, cluster: false, note: 'บ้านเดี่ยวเว้นแปลง' },
  { code: 'P10', gap_m: 90, cluster: false, note: 'คนละฝั่งซอย' },
];

/** คู่ควบคุม — ไกลพอจะให้กลไกพิกัดทำงานจริง ไว้พิสูจน์ว่าโค้ดส่วนนั้นไม่ได้ตายไปเฉย ๆ */
const CONTROL: Pair = {
  code: 'C01',
  gap_m: 200,
  cluster: false,
  note: 'คู่ควบคุม คนละโซน',
};

const ALL_PAIRS = [...PAIRS, CONTROL];

/** คู่ที่ยกมาพิมพ์เมทริกซ์เต็ม 10 × 10 ให้ดูของจริง */
const MATRIX_SAMPLES = ['P05', 'P09'];

// ── ส่วน ก. — mock สำหรับเรียก analyze() ตัวจริง ─────────────────────

type Baseline = Awaited<ReturnType<BillsService['previousUnitsForMembers']>>;

const membersOf = (pair: Pair): MemberEntity[] => [
  {
    id: 1,
    house_no: `${pair.code}-ซ้าย`,
    fname: 'สมชาย',
    lname: 'ใจดี',
    latitude: BASE_LAT,
    longitude: BASE_LNG,
    cluster_group_id: pair.cluster ? `WALL-${pair.code}` : null,
    sequence_index: pair.cluster ? 1 : null,
  } as MemberEntity,
  {
    id: 2,
    house_no: `${pair.code}-ขวา`,
    fname: 'สมหญิง',
    lname: 'ใจงาม',
    latitude: BASE_LAT,
    longitude: eastOf(BASE_LNG, pair.gap_m),
    cluster_group_id: pair.cluster ? `WALL-${pair.code}` : null,
    sequence_index: pair.cluster ? 2 : null,
  } as MemberEntity,
];

/**
 * เลขตั้งต้นห่างกัน 5 หน่วย + ประวัติการใช้เท่ากัน
 * → เลขที่อ่านได้ 1210 ให้หน่วย 10 กับหลังซ้าย และ 15 กับหลังขวา
 *   คะแนน 1.000 ต่อ 0.667 ซึ่ง "ยังไม่ทิ้งขาดสองเท่า" ตามเกณฑ์ของ judge()
 */
const baselineOfPair = (): Baseline => {
  const map = new Map();
  const history = [10, 9, 11, 10, 10, 9];
  map.set(1, {
    previous_unit: 1200,
    source: 'bill' as const,
    usage_history: history,
    typical_usage: BillsService.usageBaseline(history),
    already_billed: false,
  });
  map.set(2, {
    previous_unit: 1195,
    source: 'bill' as const,
    usage_history: history,
    typical_usage: BillsService.usageBaseline(history),
    already_billed: false,
  });
  return map as Baseline;
};

const fakeFile = () =>
  ({
    originalname: 'meter.jpg',
    buffer: Buffer.from('x'),
  }) as Express.Multer.File;

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

const dto: ScanBatchDto = { billing_month: '08', billing_year: '2026' };

/** รูปถ่ายที่จุดของมิเตอร์ตัวซ้ายพอดี — เข้าข้างพิกัดเต็มที่ ไม่ใส่ความคลาดใด ๆ */
const photoAtLeftMeter = (): PhotoMetadata => ({
  has_exif: true,
  captured_at: new Date('2026-08-15T09:00:00'),
  latitude: BASE_LAT,
  longitude: BASE_LNG,
});

const analyzePair = async (pair: Pair) => {
  const memberRepository = {
    find: jest.fn().mockResolvedValue(membersOf(pair)),
  };
  const villageRepository = { findOne: jest.fn().mockResolvedValue(null) };
  const meterReadingsService = {
    extractMeterUnit: jest.fn().mockResolvedValue(ocrResult('1210')),
  };
  const billsService = {
    previousUnitsForMembers: jest.fn().mockResolvedValue(baselineOfPair()),
    readingsOfMembers: jest.fn().mockResolvedValue([]),
    learnedMeterLocations: jest.fn().mockReturnValue(new Map()),
    knownMeterDigits: jest.fn().mockReturnValue(new Map()),
  };
  const photoMetadataService = {
    read: jest.fn().mockReturnValue(photoAtLeftMeter()),
  };

  const service = new ScanBatchService(
    memberRepository as unknown as Repository<MemberEntity>,
    villageRepository as unknown as Repository<VillageEntity>,
    meterReadingsService as unknown as MeterReadingsService,
    billsService as unknown as BillsService,
    photoMetadataService as unknown as PhotoMetadataService,
  );

  const res = await service.analyze([fakeFile()], dto);
  return res.results[0];
};

// ── ส่วน ข. — จำลองรูป 10 ใบต่อมิเตอร์ แล้วจับคู่ไขว้ ────────────────

/** PRNG แบบกำหนดเมล็ดได้ — ผลรันซ้ำต้องได้ตัวเลขเดิมทุกครั้ง ไม่งั้นรายงานเชื่อไม่ได้ */
const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** สุ่มค่าแจกแจงปกติด้วย Box-Muller */
const gaussian = (rand: () => number, sigma: number) => {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

/** ยุบหลายรูปเป็นจุดเดียวด้วยมัธยฐาน — สูตรเดียวกับ learnedMeterLocations() */
const medianPoint = (points: LatLng[]): LatLng => ({
  latitude: median(points.map((p) => p.latitude)),
  longitude: median(points.map((p) => p.longitude)),
});

/** ถ่ายมิเตอร์หนึ่งตัว N รูป — แต่ละรูปได้พิกัดที่คลาดไปคนละทาง */
const shoot = (
  truth: LatLng,
  sigma: number,
  rand: () => number,
  count: number,
): LatLng[] =>
  Array.from({ length: count }, () => ({
    latitude: truth.latitude + gaussian(rand, sigma) / METERS_PER_DEG_LAT,
    longitude:
      truth.longitude + gaussian(rand, sigma) / metersPerDegLng(BASE_LAT),
  }));

interface CrossResult {
  /** ตอบถูกกี่คู่จาก 100 */
  correct: number;
  total: number;
  /** แถวที่ i = รูปซ้ายใบที่ i+1 ตอบถูกกี่ใบจาก 10 */
  perLeftPhoto: number[];
  /** เมทริกซ์ผลดิบ true = ตอบ 'ขวา' ถูก */
  grid: boolean[][];
  /** ป้ายที่ได้ทั้งหมด นับแยกทิศ */
  labels: Record<string, number>;
  /** สัดส่วนคู่เทียบที่ระบบติดธง reliable ว่าทิศนี้เชื่อได้ */
  reliableRate: number;
  /** ยุบ 10 รูปเป็นค่ากลางก่อนเทียบ แล้วตอบถูกไหม */
  medianCorrect: boolean;
}

/** หนึ่งรอบเก็บข้อมูล: ถ่ายซ้าย 10 ใบ ขวา 10 ใบ แล้วจับคู่ไขว้ทุกแบบ */
const runSession = (pair: Pair, sigma: number, seed: number): CrossResult => {
  const rand = mulberry32(seed);
  const leftTruth: LatLng = { latitude: BASE_LAT, longitude: BASE_LNG };
  const rightTruth: LatLng = {
    latitude: BASE_LAT,
    longitude: eastOf(BASE_LNG, pair.gap_m),
  };

  const leftPhotos = shoot(leftTruth, sigma, rand, PHOTOS_PER_METER);
  const rightPhotos = shoot(rightTruth, sigma, rand, PHOTOS_PER_METER);

  const grid: boolean[][] = [];
  const perLeftPhoto: number[] = [];
  const labels: Record<string, number> = {
    ขวา: 0,
    ซ้าย: 0,
    บน: 0,
    ล่าง: 0,
    ตอบไม่ได้: 0,
  };
  let correct = 0;
  let reliableCount = 0;

  for (const left of leftPhotos) {
    const row: boolean[] = [];
    let hits = 0;

    for (const right of rightPhotos) {
      const res = RelativeDirectionUtil.compare(left, right);
      const label = res?.relative_direction ?? 'ตอบไม่ได้';
      labels[label] = (labels[label] ?? 0) + 1;
      if (res?.reliable) reliableCount++;

      const ok = label === 'ขวา';
      row.push(ok);
      if (ok) {
        hits++;
        correct++;
      }
    }

    grid.push(row);
    perLeftPhoto.push(hits);
  }

  const medianRes = RelativeDirectionUtil.compare(
    medianPoint(leftPhotos),
    medianPoint(rightPhotos),
  );

  return {
    correct,
    total: PHOTOS_PER_METER * PHOTOS_PER_METER,
    perLeftPhoto,
    grid,
    labels,
    reliableRate: reliableCount / (PHOTOS_PER_METER * PHOTOS_PER_METER),
    medianCorrect: medianRes?.relative_direction === 'ขวา',
  };
};

/** ทำซ้ำหลายรอบเพื่อให้ตัวเลขสรุปไม่ขึ้นกับรอบเดียวที่บังเอิญดี */
const aggregate = (pair: Pair, sigma: number) => {
  let correct = 0;
  let total = 0;
  let medianCorrect = 0;
  let reliable = 0;

  for (let s = 0; s < SESSIONS; s++) {
    const res = runSession(pair, sigma, 20260820 + s * 7919);
    correct += res.correct;
    total += res.total;
    reliable += res.reliableRate;
    if (res.medianCorrect) medianCorrect++;
  }

  return {
    single: correct / total,
    median: medianCorrect / SESSIONS,
    reliable: reliable / SESSIONS,
  };
};

// ── รายงาน ──────────────────────────────────────────────────────────

interface Row {
  pair: Pair;
  confidence: string;
  suggested: string;
  reason: string;
  open_single: number;
  open_median: number;
  eaves_single: number;
  eaves_median: number;
  open_reliable: number;
}

const rows: Row[] = [];

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const pad = (s: string, n: number) =>
  s + ' '.repeat(Math.max(0, n - [...s].length));

describe('รายงานผลทดสอบ — มิเตอร์ 10 คู่ที่อยู่ใกล้กัน', () => {
  describe.each(ALL_PAIRS)(
    '$code · ห่างกัน $gap_m ม. · $note',
    (pair: Pair) => {
      let item: Awaited<ReturnType<typeof analyzePair>>;

      beforeAll(async () => {
        item = await analyzePair(pair);
        const open = aggregate(pair, 4);
        const eaves = aggregate(pair, 15);

        rows.push({
          pair,
          confidence: item.confidence,
          suggested: item.suggestion?.house_no ?? '—',
          reason: item.reason,
          open_single: open.single,
          open_median: open.median,
          eaves_single: eaves.single,
          eaves_median: eaves.median,
          open_reliable: open.reliable,
        });
      });

      it('ก. ระบบต้องไม่ฟันธงบ้านเองเมื่อเลขมิเตอร์แยกไม่ขาด', () => {
        expect(item.confidence).not.toBe('high');
      });

      it('ข. ถ้าเป็นกลุ่มมิเตอร์ ต้องคืน ambiguous และสั่งให้ไล่ตามลำดับ', () => {
        if (!pair.cluster) return;
        expect(item.confidence).toBe('ambiguous');
        expect(item.suggestion).toBeNull();
        expect(item.reason).toMatch(/ลำดับ/);
      });

      it('ค. ตัวเลือกทุกหลังต้องพก cluster_group_id + sequence_index ไปด้วย', () => {
        for (const candidate of item.candidates) {
          expect(candidate).toHaveProperty('cluster_group_id');
          expect(candidate).toHaveProperty('sequence_index');
        }
      });

      it('ง. จับคู่ไขว้ต้องได้ครบ 100 คู่เทียบต่อหนึ่งรอบ', () => {
        const session = runSession(pair, 4, 20260820);
        expect(session.total).toBe(100);
        expect(session.perLeftPhoto).toHaveLength(PHOTOS_PER_METER);
        expect(session.perLeftPhoto.reduce((a, b) => a + b, 0)).toBe(
          session.correct,
        );
      });
    },
  );

  it('คู่ควบคุมที่ห่าง 200 ม. ต้องเป็นคู่เดียวที่พิกัดตัดสินบ้านได้', () => {
    const near = rows.filter((r) => r.pair.code !== CONTROL.code);
    const control = rows.find((r) => r.pair.code === CONTROL.code);

    expect(near.every((r) => r.suggested === '—')).toBe(true);
    expect(control?.confidence).toBe('medium');
  });

  it('ระยะยิ่งใกล้ ความถูกต้องของการทายซ้าย/ขวายิ่งตก', () => {
    const byGap = [...rows].sort((a, b) => a.pair.gap_m - b.pair.gap_m);
    const closest = byGap[0];
    const farthest = byGap[byGap.length - 1];

    // ติดกำแพง 0.3 ม. — ป้ายทิศมีสี่ค่า การเดาสุ่มล้วนให้ราว 25%
    expect(closest.open_single).toBeLessThan(0.4);
    expect(farthest.open_single).toBeGreaterThan(0.99);
  });

  it('ยุบ 10 รูปเป็นค่ากลางก่อนเทียบ ต้องดีกว่าใช้รูปเดี่ยวเสมอ', () => {
    for (const r of rows) {
      expect(r.open_median).toBeGreaterThanOrEqual(r.open_single - 1e-9);
    }
  });

  afterAll(() => {
    const sorted = [...rows].sort((a, b) =>
      a.pair.code.localeCompare(b.pair.code),
    );
    const lines: string[] = [];
    const rule = (ch = '─', n = 104) => ch.repeat(n);

    // ═══ ตาราง ก. ═══
    lines.push('');
    lines.push(rule('═'));
    lines.push('ผลทดสอบ ก. — ระบบชี้บ้านไหน เมื่อเลขมิเตอร์แยกสองหลังไม่ขาด');
    lines.push(rule('═'));
    lines.push(
      pad('คู่', 6) +
        pad('ห่าง(ม.)', 10) +
        pad('กลุ่ม', 8) +
        pad('ผลตัดสิน', 13) +
        pad('บ้านที่เสนอ', 14) +
        'เหตุผลย่อ',
    );
    lines.push(rule());
    for (const r of sorted) {
      lines.push(
        pad(r.pair.code, 6) +
          pad(String(r.pair.gap_m), 10) +
          pad(r.pair.cluster ? 'ใช่' : '—', 8) +
          pad(r.confidence, 13) +
          pad(r.suggested, 14) +
          r.reason.slice(0, 44),
      );
    }

    // ═══ ตาราง ข. ═══
    lines.push('');
    lines.push(rule('═'));
    lines.push(
      `ผลทดสอบ ข. — ถ่ายมิเตอร์ละ ${PHOTOS_PER_METER} รูป จับคู่ไขว้ ${PHOTOS_PER_METER}×${PHOTOS_PER_METER} = 100 คู่เทียบ`,
    );
    lines.push(
      `ทำซ้ำ ${SESSIONS} รอบต่อคู่ (รวม ${(SESSIONS * 100).toLocaleString()} คู่เทียบต่อช่อง)`,
    );
    lines.push(rule('═'));
    lines.push(
      pad('คู่', 6) +
        pad('ห่าง(ม.)', 10) +
        pad('โล่ง·รูปเดี่ยว', 16) +
        pad('โล่ง·ค่ากลาง10', 17) +
        pad('ชายคา·รูปเดี่ยว', 18) +
        pad('ชายคา·ค่ากลาง10', 18) +
        'ติดธง reliable',
    );
    lines.push(rule());
    for (const r of sorted) {
      lines.push(
        pad(r.pair.code, 6) +
          pad(String(r.pair.gap_m), 10) +
          pad(pct(r.open_single), 16) +
          pad(pct(r.open_median), 17) +
          pad(pct(r.eaves_single), 18) +
          pad(pct(r.eaves_median), 18) +
          pct(r.open_reliable),
      );
    }
    lines.push(rule());
    lines.push('รูปเดี่ยว = เอารูปหนึ่งใบเทียบอีกใบ (สภาพจริงตอนจดครั้งเดียว)');
    lines.push(
      `ค่ากลาง${PHOTOS_PER_METER} = ยุบ ${PHOTOS_PER_METER} รูปเป็นจุดเดียวด้วยมัธยฐานก่อนเทียบ (สิ่งที่ learnedMeterLocations ทำ)`,
    );

    // ═══ เมทริกซ์ตัวอย่าง ═══
    for (const code of MATRIX_SAMPLES) {
      const row = sorted.find((r) => r.pair.code === code);
      if (!row) continue;

      const session = runSession(row.pair, 4, 20260820);
      lines.push('');
      lines.push(rule('═'));
      lines.push(
        `เมทริกซ์ ${PHOTOS_PER_METER}×${PHOTOS_PER_METER} ของคู่ ${code} · ห่างกัน ${row.pair.gap_m} ม. · ที่โล่ง σ=4 ม. (รอบที่ 1)`,
      );
      lines.push(rule('═'));
      lines.push(
        pad('', 12) +
          Array.from({ length: PHOTOS_PER_METER }, (_, j) =>
            pad(`ข${j + 1}`, 4),
          ).join('') +
          '  ถูก/10',
      );
      lines.push(rule());
      session.grid.forEach((gridRow, i) => {
        lines.push(
          pad(`รูปซ้าย ${i + 1}`, 12) +
            gridRow.map((ok) => pad(ok ? '✓' : '·', 4)).join('') +
            `  ${session.perLeftPhoto[i]}/10`,
        );
      });
      lines.push(rule());
      lines.push(
        `รวม ${session.correct}/100 · ` +
          Object.entries(session.labels)
            .filter(([, n]) => n > 0)
            .map(([label, n]) => `${label} ${n}`)
            .join(' · '),
      );
      lines.push(
        `ยุบเป็นค่ากลางก่อนเทียบ: ${session.medianCorrect ? 'ตอบถูก' : 'ตอบผิด'}`,
      );
    }

    lines.push('');
    lines.push('✓ = ตอบ "ขวา" ถูก   · = ตอบผิด (ได้ ซ้าย/บน/ล่าง แทน)');
    lines.push('');

    console.log(lines.join('\n'));
  });
});
