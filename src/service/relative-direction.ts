import { PhotoMetadataService } from './photo-metadata.service';

/** ทิศทางแบบที่คนหน้างานใช้จริง — สี่ทิศพอ ไม่ต้องมี "ตะวันออกเฉียงเหนือ" */
export type RelativeDirectionLabel = 'บน' | 'ล่าง' | 'ซ้าย' | 'ขวา';

/** พิกัดหนึ่งจุด — รับได้ทั้งจากทะเบียนบ้านและจาก EXIF ของรูป */
export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * ผลการเทียบพิกัดสองจุด (จุดอ้างอิง → จุดใหม่)
 *
 * ส่งกลับไปให้หน้าเว็บทั้งก้อน ไม่ได้ส่งแค่ข้อความ เพราะหน้าเว็บต้องตัดสินใจต่อได้เอง
 * ว่าจะขึ้นป้ายแบบไหน (โดยเฉพาะเมื่อ `reliable` เป็น false)
 */
export interface RelativeDirection {
  /** ระยะห่างเป็นเมตร ปัดทศนิยม 2 ตำแหน่ง */
  distance_meters: number;
  /** มุมกวาดจากทิศเหนือตามเข็มนาฬิกา 0-360 (null = สองจุดทับกันสนิท) */
  bearing_deg: number | null;
  /** ทิศทางของจุดใหม่เทียบกับจุดอ้างอิง — null = ตัดสินไม่ได้ */
  relative_direction: RelativeDirectionLabel | null;
  /** ระยะอยู่ในเกณฑ์ ≤ 0.3 ม. ที่ตั้งไว้ */
  within_threshold: boolean;
  /**
   * ตัวเลขทิศทางนี้เชื่อถือได้ไหม
   *
   * **เกือบทุกครั้งจะเป็น false เมื่อระยะอยู่ในเกณฑ์ 0.3 ม.** — ดูเหตุผลที่ RelativeDirectionUtil
   */
  reliable: boolean;
  /** ทิศทางนี้มาจาก sequence_index ไม่ได้มาจากพิกัด (พิกัดซ้ำกันเป๊ะ) */
  from_sequence: boolean;
}

/**
 * เทียบพิกัดสองจุดแล้วบอกว่าจุดใหม่อยู่ทาง บน/ล่าง/ซ้าย/ขวา ของจุดเดิม
 *
 * ═══ ⚠️ อ่านก่อนเอาไปใช้ตัดสินใจอะไร ═══
 *
 * ที่ระยะ 0.3 เมตร **ตัวเลขทิศทางที่ได้คือเสียงรบกวน ไม่ใช่ตำแหน่งจริง**
 *
 *   - GPS มือถือคลาดเคลื่อน 3-5 ม. ในที่โล่ง และ 10-30 ม. ใต้ชายคา/ระหว่างตึก
 *   - เกณฑ์ที่ตั้งไว้คือ 0.3 ม. ซึ่งเล็กกว่าความคลาดเคลื่อนอย่างต่ำ **สิบเท่า**
 *   - แปลว่าถ่ายมิเตอร์ตัวเดิมสองครั้งติดกัน ทิศที่ได้จะสุ่มไปคนละทางทุกครั้ง
 *     และถ่ายมิเตอร์คนละตัวที่ห่างกัน 30 ซม. ก็ให้ทิศเดียวกันได้พอ ๆ กัน
 *
 * ทั้งระบบนี้จึงมีข้อตกลงอยู่แล้วว่า **ห้ามใช้พิกัดเดาตำแหน่งซ้าย/ขวาในกลุ่มมิเตอร์ที่ติดกัน**
 * (ดู `db/migrate-meter-clusters.sql` และ `ScanBatchService.sameCluster`) ตัวที่ตอบคำถาม
 * "ตัวไหนของบ้านไหน" ได้จริงคือ `sequence_index` ที่จดไว้ล่วงหน้า ซึ่งไม่แกว่งตามสัญญาณ
 *
 * ตัวคำนวณนี้จึงมีไว้ **แสดงผลให้คนดูประกอบ** เท่านั้น และติดธง `reliable: false`
 * มาด้วยทุกครั้งที่ระยะต่ำกว่าความคลาดเคลื่อนของเครื่อง — ห้ามเอาไปเป็นเงื่อนไข
 * ในการจับคู่บ้านหรือออกบิลเด็ดขาด ไม่งั้นบิลจะไปออกผิดบ้านโดยที่หน้าจอดูน่าเชื่อถือดี
 */
export class RelativeDirectionUtil {
  /** เกณฑ์ที่ถือว่า "อาจเป็นมิเตอร์คนละตัวบนกำแพงเดียวกัน" (เมตร) */
  static readonly THRESHOLD_M = 0.3;

  /**
   * ความคลาดเคลื่อนต่ำสุดที่ GPS มือถือทำได้จริงในที่โล่ง (เมตร)
   *
   * ระยะที่วัดได้ต่ำกว่านี้ = อยู่ใต้พื้นเสียงรบกวน ทิศที่คำนวณได้จึงไม่ใช่ข้อมูล
   */
  static readonly GPS_FLOOR_M = 3;

  /** องศาต่อเมตรของละติจูด — ใช้แปลงผลต่างพิกัดเป็นระยะบนพื้น */
  private static readonly METERS_PER_DEGREE = 111_320;

  /**
   * ระยะห่างเป็นเมตร
   *
   * ใช้ตัวเดียวกับทั้งระบบ (`PhotoMetadataService.distanceMeters`) ไม่เขียนใหม่ —
   * มีสูตรระยะทางสองตัวในโปรเจกต์เดียวแปลว่าวันหนึ่งจะได้คำตอบคนละค่าจากที่เดียวกัน
   *
   * ตัวนั้นเป็นสูตรระนาบที่หดแกน X ด้วย cos(ละติจูด) ซึ่งในระยะระดับเมตรให้ผลเท่ากับ
   * Haversine ทุกตัวเลขที่แสดงได้ (ต่างกันระดับ 10⁻⁹ ม.) และไม่มี asin/sqrt ซ้อน
   */
  static distanceMeters(from: LatLng, to: LatLng): number {
    return PhotoMetadataService.distanceMeters(from, to);
  }

  /**
   * มุมกวาดจากทิศเหนือตามเข็มนาฬิกา (0-360) — null เมื่อสองจุดทับกันสนิท
   *
   * ใช้ atan2(ตะวันออก, เหนือ) บนระนาบท้องถิ่น ไม่ใช่สูตร great-circle เพราะระยะ
   * ระดับเมตรไม่มีทางเห็นความต่าง และสูตรนี้อ่านออกว่ากำลังทำอะไรอยู่
   */
  static bearingDegrees(from: LatLng, to: LatLng): number | null {
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const north =
      (to.latitude - from.latitude) * RelativeDirectionUtil.METERS_PER_DEGREE;
    const east =
      (to.longitude - from.longitude) *
      Math.cos(toRad((from.latitude + to.latitude) / 2)) *
      RelativeDirectionUtil.METERS_PER_DEGREE;

    if (north === 0 && east === 0) return null;

    return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  }

  /**
   * มุม → ทิศทางสี่ทาง
   *
   * แบ่งที่ 45° ตามแนวทแยง: 315-45 = บน, 45-135 = ขวา, 135-225 = ล่าง, 225-315 = ซ้าย
   * ขอบเขตแต่ละช่วงเป็นแบบ "รวมค่าเริ่มต้น ไม่รวมค่าสิ้นสุด" เพื่อไม่ให้มุม 45 องศาเป๊ะ
   * ตกได้สองทิศพร้อมกัน
   */
  static labelOf(bearing: number | null): RelativeDirectionLabel | null {
    if (bearing === null || !Number.isFinite(bearing)) return null;

    const angle = ((bearing % 360) + 360) % 360;
    if (angle >= 315 || angle < 45) return 'บน';
    if (angle < 135) return 'ขวา';
    if (angle < 225) return 'ล่าง';
    return 'ซ้าย';
  }

  /**
   * เทียบพิกัดจุดใหม่กับจุดที่ลงทะเบียนไว้
   *
   * `sequence` คือลำดับตำแหน่งบนกำแพงของทั้งสองจุด (ถ้ารู้) — ใช้เป็นตัวสำรองเมื่อ
   * พิกัดซ้ำกันเป๊ะทุกทศนิยม ซึ่งเกิดขึ้นจริงบ่อยกว่าที่คิดเมื่อยืนถ่ายที่เดิม
   * เพราะเครื่องคืนค่าที่ปัดแล้วชุดเดิมออกมา
   *
   * ⚠️ `reliable` เป็น false เสมอเมื่อระยะต่ำกว่า GPS_FLOOR_M — ผู้เรียกต้องเคารพธงนี้
   */
  static compare(
    from: LatLng | null | undefined,
    to: LatLng | null | undefined,
    sequence?: { from?: number | null; to?: number | null },
  ): RelativeDirection | null {
    if (
      !RelativeDirectionUtil.usable(from) ||
      !RelativeDirectionUtil.usable(to)
    ) {
      return null;
    }

    const distance = RelativeDirectionUtil.distanceMeters(from, to);
    const bearing = RelativeDirectionUtil.bearingDegrees(from, to);
    const label = RelativeDirectionUtil.labelOf(bearing);

    const bySequence = RelativeDirectionUtil.fromSequence(sequence);
    const useSequence = label === null && bySequence !== null;

    return {
      distance_meters: Math.round(distance * 100) / 100,
      bearing_deg: bearing === null ? null : Math.round(bearing * 10) / 10,
      relative_direction: useSequence ? bySequence : label,
      within_threshold: distance <= RelativeDirectionUtil.THRESHOLD_M,
      // ลำดับที่จดไว้ล่วงหน้าไม่แกว่งตามสัญญาณ จึงเชื่อได้ ต่างจากทิศที่คำนวณจากพิกัด
      reliable: useSequence
        ? true
        : distance >= RelativeDirectionUtil.GPS_FLOOR_M,
      from_sequence: useSequence,
    };
  }

  /**
   * ซ้าย/ขวา จากลำดับตำแหน่งบนกำแพง — ตัวสำรองตอนพิกัดซ้ำกันเป๊ะ
   *
   * `sequence_index` เรียงซ้าย→ขวาเมื่อหันหน้าเข้าหากำแพง ตัวที่มีเลขมากกว่าจึงอยู่ขวากว่า
   * นี่คือข้อมูลชิ้นเดียวในเรื่องนี้ที่ไม่ได้มาจากเซนเซอร์ จึงไม่แกว่งตามสัญญาณ
   */
  private static fromSequence(sequence?: {
    from?: number | null;
    to?: number | null;
  }): RelativeDirectionLabel | null {
    const from = Number(sequence?.from);
    const to = Number(sequence?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      return null;
    }
    return to > from ? 'ขวา' : 'ซ้าย';
  }

  /** พิกัด (0, 0) คือค่าที่ยังไม่ได้กรอก ไม่ใช่จุดกลางมหาสมุทรแอตแลนติก */
  private static usable(point: LatLng | null | undefined): point is LatLng {
    if (!point) return false;

    const { latitude, longitude } = point;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return !(Number(latitude) === 0 && Number(longitude) === 0);
  }
}
