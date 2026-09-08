import { RelativeDirectionUtil } from './relative-direction';

/**
 * ทิศทางสัมพัทธ์จากพิกัด — คณิตศาสตร์ต้องถูก และธง `reliable` ต้องพูดความจริง
 *
 * ═══ สิ่งที่เทสต์ชุดนี้ล็อกไว้เป็นพิเศษ ═══
 *
 * สูตรจะถูกแค่ไหนก็ไม่ช่วย ถ้าคนที่เอาไปใช้เข้าใจผิดว่าตัวเลขนี้เชื่อได้ที่ระยะ 30 ซม.
 * GPS มือถือคลาดเคลื่อน 3-30 ม. ทิศที่คำนวณจากระยะระดับเซนติเมตรจึงเป็นเสียงรบกวน
 * เทสต์ครึ่งหลังจึงล็อกว่า `reliable` ต้องเป็น false ทุกครั้งที่ระยะต่ำกว่าเกณฑ์
 * `DIRECTION_TRUST_M` และตัวที่เชื่อได้จริงคือ `sequence_index` ซึ่งไม่ได้มาจากเซนเซอร์
 *
 * ⚠️ เกณฑ์ปัจจุบันคือ 10 ม. ซึ่งเป็นค่าที่เจ้าของระบบเลือกเอง ไม่ใช่ค่าที่ข้อมูลชี้ (20 ม.)
 *    เทสต์ชุดนี้ล็อกแค่ว่าธงทำงานตามเกณฑ์ที่ตั้งไว้ ไม่ได้แปลว่าทิศที่ได้ตรงเกณฑ์พอดี
 *    แม่นพอจะเอาไปตัดสินว่าเป็นบ้านไหน
 */

/** จุดอ้างอิงกลางหมู่บ้าน (โคราช) */
const BASE = { latitude: 14.9799, longitude: 102.0977 };

const METERS_PER_DEGREE = 111_320;

/** เลื่อนจากจุดอ้างอิงไปทางเหนือ/ตะวันออกกี่เมตร */
const offset = (northM: number, eastM: number) => ({
  latitude: BASE.latitude + northM / METERS_PER_DEGREE,
  longitude:
    BASE.longitude +
    eastM / (METERS_PER_DEGREE * Math.cos((BASE.latitude * Math.PI) / 180)),
});

describe('RelativeDirectionUtil — ระยะและทิศทาง', () => {
  describe('ระยะทาง', () => {
    it('คำนวณระยะระดับเซนติเมตรได้ตรง', () => {
      expect(
        RelativeDirectionUtil.distanceMeters(BASE, offset(0.2, 0)),
      ).toBeCloseTo(0.2, 3);
      expect(
        RelativeDirectionUtil.distanceMeters(BASE, offset(0, 0.3)),
      ).toBeCloseTo(0.3, 3);
      // 3-4-5 — ทั้งสองแกนพร้อมกัน ไม่ใช่แกนเดียว
      expect(
        RelativeDirectionUtil.distanceMeters(BASE, offset(3, 4)),
      ).toBeCloseTo(5, 2);
    });

    it('จุดเดียวกันได้ 0', () => {
      expect(RelativeDirectionUtil.distanceMeters(BASE, { ...BASE })).toBe(0);
    });
  });

  describe('ทิศทางสี่ทาง', () => {
    const directionTo = (northM: number, eastM: number) =>
      RelativeDirectionUtil.compare(BASE, offset(northM, eastM))
        ?.relative_direction;

    it('เหนือ = บน, ใต้ = ล่าง, ตะวันออก = ขวา, ตะวันตก = ซ้าย', () => {
      expect(directionTo(0.2, 0)).toBe('บน');
      expect(directionTo(-0.2, 0)).toBe('ล่าง');
      expect(directionTo(0, 0.2)).toBe('ขวา');
      expect(directionTo(0, -0.2)).toBe('ซ้าย');
    });

    it('แกนที่ต่างมากกว่าเป็นตัวชี้ทิศ (เฉียงแต่ค่อนไปทางหนึ่ง)', () => {
      // เหนือ 0.2 ตะวันออก 0.1 → ยังนับเป็น "บน"
      expect(directionTo(0.2, 0.1)).toBe('บน');
      // ตะวันออก 0.2 เหนือ 0.1 → เป็น "ขวา"
      expect(directionTo(0.1, 0.2)).toBe('ขวา');
    });

    it('มุมตรงเส้นแบ่ง 45/135/225/315 ต้องตกทิศเดียว ไม่กำกวม', () => {
      expect(RelativeDirectionUtil.labelOf(45)).toBe('ขวา');
      expect(RelativeDirectionUtil.labelOf(44.9)).toBe('บน');
      expect(RelativeDirectionUtil.labelOf(135)).toBe('ล่าง');
      expect(RelativeDirectionUtil.labelOf(225)).toBe('ซ้าย');
      expect(RelativeDirectionUtil.labelOf(315)).toBe('บน');
      expect(RelativeDirectionUtil.labelOf(0)).toBe('บน');
      expect(RelativeDirectionUtil.labelOf(359.9)).toBe('บน');
    });

    it('มุมกวาดนับจากทิศเหนือตามเข็มนาฬิกา', () => {
      expect(
        RelativeDirectionUtil.bearingDegrees(BASE, offset(1, 0)),
      ).toBeCloseTo(0, 1);
      expect(
        RelativeDirectionUtil.bearingDegrees(BASE, offset(0, 1)),
      ).toBeCloseTo(90, 1);
      expect(
        RelativeDirectionUtil.bearingDegrees(BASE, offset(-1, 0)),
      ).toBeCloseTo(180, 1);
      expect(
        RelativeDirectionUtil.bearingDegrees(BASE, offset(0, -1)),
      ).toBeCloseTo(270, 1);
    });
  });

  /**
   * เขตที่ถือว่า "GPS แยกมิเตอร์ไม่ออก" — กว้าง 15 ม. ไม่ใช่ 30 ซม.
   *
   * ธงนี้ดูระยะ **ที่วัดได้** ไม่ใช่ระยะจริง เกณฑ์จึงต้องกว้างเท่าความคลาดของเครื่อง
   * (3-10 ม. ที่โล่ง, 10-30 ม. ใต้ชายคา) ไม่ใช่เท่าระยะห่างจริงของมิเตอร์บนกำแพง
   *
   * 15 ม. มาจากการทดลองภาคสนาม (`meter-bill.xlsx` ตารางที่ 4.9) — มีเพียง 2 คู่จาก 10 คู่
   * ที่หมุดห่างกันพ้นเขตนี้ ดู `GPS_POLICY.directionTrustM` ใน measurement.constants.ts
   */
  describe('เขตที่ GPS แยกไม่ออก (15 เมตร)', () => {
    it('ระยะสั้นกว่าเกณฑ์ เข้าข่าย "อาจเป็นมิเตอร์คนละตัวที่ GPS แยกไม่ออก"', () => {
      expect(
        RelativeDirectionUtil.compare(BASE, offset(0, 0.25))?.within_threshold,
      ).toBe(true);
      // ระยะที่ GPS มือถือคลาดได้ตามปกติ — ต้องอยู่ในเขตนี้ ไม่ใช่หลุดออกไป
      expect(
        RelativeDirectionUtil.compare(BASE, offset(0, 5))?.within_threshold,
      ).toBe(true);
      expect(
        RelativeDirectionUtil.compare(BASE, offset(0, 8))?.within_threshold,
      ).toBe(true);
      // 12 ม. เคยหลุดเขตตอนเกณฑ์เป็น 10 ม. — ภาคสนามชี้ว่ายังอยู่ในเขตที่ทิศเป็นการเดา
      expect(
        RelativeDirectionUtil.compare(BASE, offset(0, 12))?.within_threshold,
      ).toBe(true);
    });

    it('ระยะ > 15 ม. ถือเป็นคนละจุดจริง ๆ พ้นเขตที่ GPS แยกไม่ออก', () => {
      expect(
        RelativeDirectionUtil.compare(BASE, offset(0, 18))?.within_threshold,
      ).toBe(false);
      expect(
        RelativeDirectionUtil.compare(BASE, offset(0, 40))?.within_threshold,
      ).toBe(false);
    });

    /**
     * ธงนี้กับ `reliable` ตั้งอยู่บนเส้นเดียวกัน (THRESHOLD_M = DIRECTION_TRUST_M)
     * ต้องเป็นคนละด้านของเส้นเสมอ ไม่งั้นจะมีช่วงที่บอกว่าทั้งแยกไม่ออกและเชื่อทิศได้
     */
    it('ต่ำกว่าเส้น = แยกไม่ออก · เหนือเส้น = เชื่อทิศได้ ไม่มีช่วงที่ขัดกันเอง', () => {
      const inside = RelativeDirectionUtil.compare(BASE, offset(0, 12));
      const outside = RelativeDirectionUtil.compare(BASE, offset(0, 18));

      expect(inside?.within_threshold).toBe(true);
      expect(inside?.reliable).toBe(false);
      expect(outside?.within_threshold).toBe(false);
      expect(outside?.reliable).toBe(true);
    });
  });

  describe('ความน่าเชื่อถือ — ส่วนที่สำคัญที่สุดของไฟล์นี้', () => {
    it('ระยะในเกณฑ์ 0.3 ม. → reliable ต้องเป็น false เสมอ', () => {
      // 0.3 ม. เล็กกว่าความคลาดเคลื่อนของ GPS มือถืออย่างต่ำสิบเท่า ทิศที่ได้จึงเป็น
      // เสียงรบกวน — ปล่อยให้ธงนี้เป็น true เมื่อไหร่ จะมีคนเอาไปตัดสินว่าเป็นบ้านไหน
      const near = RelativeDirectionUtil.compare(BASE, offset(0, 0.2));

      expect(near?.relative_direction).toBe('ขวา');
      expect(near?.within_threshold).toBe(true);
      expect(near?.reliable).toBe(false);
    });

    it('ระยะ 8 ม. ยังไม่ถึงเกณฑ์ 15 ม. → reliable เป็น false', () => {
      // เขตที่ GPS บอกซ้าย/ขวาไม่ได้ครอบถึง 15 ม. ต่ำกว่านั้นทิศเป็นเสียงรบกวน
      expect(RelativeDirectionUtil.compare(BASE, offset(0, 8))?.reliable).toBe(
        false,
      );
    });

    /**
     * เคสที่เปลี่ยนพฤติกรรมจริงจากผลการทดลอง — 12 ม. เคยติดธง reliable ตอนเกณฑ์เป็น 10 ม.
     * ภาคสนามชี้ว่าเขตที่เชื่อไม่ได้กว้างถึง 15 ม. ระยะนี้จึงต้องเงียบ ไม่ใช่ขึ้นป้าย
     */
    it('ระยะ 12 ม. ยังอยู่ในเขตที่ภาคสนามชี้ว่าเชื่อไม่ได้ → reliable เป็น false', () => {
      expect(RelativeDirectionUtil.compare(BASE, offset(0, 12))?.reliable).toBe(
        false,
      );
    });

    it('ระยะ ≥ 15 ม. → ติดธง reliable ตามเกณฑ์ที่วัดมาจากภาคสนาม', () => {
      // ⚠️ 15 ม. มาจากการทดลอง 10 คู่ (ตารางที่ 4.9) การจำลองชี้ 20 ม. ป้ายในช่วง 15-20 ม.
      // จึงยังผิดได้ ห้ามเอาไปตัดสินว่าเป็นบ้านไหน — ตัวที่ตอบได้คือ sequence_index
      expect(RelativeDirectionUtil.compare(BASE, offset(0, 18))?.reliable).toBe(
        true,
      );
    });

    it('ระยะ ≥ 20 ม. → เชื่อทิศได้จริง (วัดมาแล้วถูก 98.7% ขึ้นไป)', () => {
      expect(RelativeDirectionUtil.compare(BASE, offset(0, 25))?.reliable).toBe(
        true,
      );
    });
  });

  describe('พิกัดซ้ำกันเป๊ะ → ถอยไปใช้ลำดับตำแหน่ง', () => {
    it('ลำดับมากกว่า = อยู่ขวากว่า (เรียงซ้าย→ขวาเมื่อหันหน้าเข้าหากำแพง)', () => {
      const result = RelativeDirectionUtil.compare(
        BASE,
        { ...BASE },
        { from: 1, to: 2 },
      );

      expect(result?.relative_direction).toBe('ขวา');
      expect(result?.from_sequence).toBe(true);
      // ลำดับที่จดไว้ล่วงหน้าไม่ได้มาจากเซนเซอร์ จึงไม่แกว่ง — เชื่อได้จริง
      expect(result?.reliable).toBe(true);
      expect(result?.bearing_deg).toBeNull();
    });

    it('ลำดับน้อยกว่า = อยู่ซ้ายกว่า', () => {
      expect(
        RelativeDirectionUtil.compare(BASE, { ...BASE }, { from: 3, to: 1 })
          ?.relative_direction,
      ).toBe('ซ้าย');
    });

    it('ไม่รู้ลำดับ หรือลำดับเท่ากัน → ตอบไม่ได้ ต้องคืน null ไม่ใช่เดา', () => {
      expect(
        RelativeDirectionUtil.compare(BASE, { ...BASE })?.relative_direction,
      ).toBeNull();
      expect(
        RelativeDirectionUtil.compare(BASE, { ...BASE }, { from: 2, to: 2 })
          ?.relative_direction,
      ).toBeNull();
    });

    it('พิกัดต่างกันแล้ว ลำดับไม่มีสิทธิ์ทับทิศที่คำนวณได้', () => {
      const result = RelativeDirectionUtil.compare(BASE, offset(0, -0.2), {
        from: 1,
        to: 2,
      });

      expect(result?.relative_direction).toBe('ซ้าย');
      expect(result?.from_sequence).toBe(false);
    });
  });

  describe('ข้อมูลไม่ครบ', () => {
    it('ขาดพิกัดฝั่งใดฝั่งหนึ่ง → null', () => {
      expect(RelativeDirectionUtil.compare(null, BASE)).toBeNull();
      expect(RelativeDirectionUtil.compare(BASE, undefined)).toBeNull();
    });

    it('พิกัด (0, 0) คือช่องที่ยังไม่ได้กรอก ไม่ใช่จุดกลางมหาสมุทร', () => {
      expect(
        RelativeDirectionUtil.compare({ latitude: 0, longitude: 0 }, BASE),
      ).toBeNull();
    });

    it('ค่าที่ไม่ใช่ตัวเลข → null ไม่ใช่ NaN ลอยไปถึงหน้าจอ', () => {
      expect(
        RelativeDirectionUtil.compare({ latitude: NaN, longitude: 102 }, BASE),
      ).toBeNull();
    });
  });
});
