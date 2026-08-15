import { Injectable, Logger } from '@nestjs/common';
import * as ExifReader from 'exifreader';

/** ข้อมูลที่ดึงได้จากตัวไฟล์รูป (ไม่ใช่จากสิ่งที่เห็นในภาพ) */
export interface PhotoMetadata {
  /** รูปนี้มี EXIF ติดมาไหม — false แปลว่าถูกลบไปแล้วระหว่างทาง ไม่ใช่ว่ากล้องไม่ได้บันทึก */
  has_exif: boolean;
  /** วันเวลาที่กดชัตเตอร์ (เวลาท้องถิ่นของกล้อง — EXIF ไม่เก็บ timezone) */
  captured_at: Date | null;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY: PhotoMetadata = {
  has_exif: false,
  captured_at: null,
  latitude: null,
  longitude: null,
};

/**
 * อ่านวันเวลาและพิกัดจาก EXIF ของไฟล์รูป
 *
 * ═══ ต้องอ่านจาก buffer ต้นฉบับเท่านั้น ═══
 *
 * EXIF หายง่ายมาก ในระบบนี้มีจุดที่ลบทิ้งอยู่ 2 จุด:
 *   1. หน้าเว็บย่อ/ครอปรูปด้วย canvas ก่อนส่ง — canvas วาดพิกเซลใหม่ metadata ไม่ติดไปด้วย
 *   2. MeterPhotoService.save() ผ่าน sharp().rotate().jpeg() — sharp ทิ้ง metadata เป็นค่าเริ่มต้น
 *
 * service นี้จึงต้องถูกเรียกกับ buffer ที่รับมาจาก multipart **ก่อน** ส่งต่อให้ใครทั้งสิ้น
 * ถ้า has_exif เป็น false แปลว่ารูปผ่านการประมวลผลมาแล้ว ไม่ใช่ว่าไม่มีข้อมูลตั้งแต่ต้น
 *
 * ═══ สิ่งที่ EXIF ให้ไม่ได้ ═══
 *
 * ไม่มีค่า accuracy บอกว่าพิกัดแม่นแค่ไหน (Geolocation API ของเบราว์เซอร์มีให้)
 * จึงประเมินไม่ได้เลยว่าพิกัดที่ได้มาเชื่อถือได้ไหม ต้องถือว่าคลาดเคลื่อนได้ 10-30 เมตรเสมอ
 */
@Injectable()
export class PhotoMetadataService {
  private readonly logger = new Logger(PhotoMetadataService.name);

  /** ไม่เคยโยน error — รูปไม่มี EXIF เป็นเรื่องปกติ ไม่ใช่ความผิดพลาด */
  read(buffer: Buffer): PhotoMetadata {
    if (!buffer?.length) return EMPTY;

    let tags: ExifReader.ExpandedTags;
    try {
      tags = ExifReader.load(buffer, { expanded: true });
    } catch {
      // ไฟล์ไม่มีบล็อก metadata เลย exifreader จะโยนออกมา ถือเป็นเคสปกติ
      return EMPTY;
    }

    const captured_at = this.readCapturedAt(tags);
    const { latitude, longitude } = this.readCoordinates(tags);

    return {
      has_exif: Boolean(tags.exif ?? tags.gps),
      captured_at,
      latitude,
      longitude,
    };
  }

  /**
   * EXIF เก็บวันที่เป็น 'YYYY:MM:DD HH:MM:SS' ซึ่งโยนเข้า new Date() ตรง ๆ ไม่ได้
   * (คั่นวันที่ด้วย : ไม่ใช่ -) ต้องแยกเลขมาประกอบเอง
   */
  private readCapturedAt(tags: ExifReader.ExpandedTags): Date | null {
    // exifreader ประกาศ description ไว้หลวม ๆ รับเป็น unknown แล้วค่อยเช็คเอง
    const raw: unknown = tags.exif?.DateTimeOriginal?.description;
    const text: unknown = Array.isArray(raw) ? raw[0] : raw;
    if (typeof text !== 'string') return null;

    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(
      text.trim(),
    );
    if (!m) return null;

    const parsed = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * exifreader แปลงพิกัดเป็นทศนิยมพร้อมเครื่องหมายให้แล้วเมื่อใช้ expanded: true
   * (ซีกใต้/ตะวันตกได้ค่าติดลบ) จึงไม่ต้องคำนวณจาก GPSLatitudeRef เอง
   */
  private readCoordinates(tags: ExifReader.ExpandedTags): {
    latitude: number | null;
    longitude: number | null;
  } {
    const latitude = tags.gps?.Latitude;
    const longitude = tags.gps?.Longitude;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return { latitude: null, longitude: null };
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { latitude: null, longitude: null };
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      this.logger.warn(`พิกัดใน EXIF อยู่นอกช่วง: ${latitude}, ${longitude}`);
      return { latitude: null, longitude: null };
    }
    // (0, 0) คือกลางมหาสมุทรแอตแลนติก — กล้องที่ยังจับดาวเทียมไม่ได้บันทึกค่านี้บ่อยมาก
    // ถือเป็น "ไม่มีพิกัด" ดีกว่าปล่อยไปคำนวณระยะแล้วได้หมื่นกิโลเมตร
    if (latitude === 0 && longitude === 0) {
      return { latitude: null, longitude: null };
    }

    return { latitude, longitude };
  }

  /**
   * ระยะทางระหว่างสองพิกัดเป็นเมตร (Haversine)
   *
   * ที่ละติจูดไทย 0.00001° ≈ 1.1 เมตรทั้งสองแกน ระยะระดับร้อยเมตรจึงคลาดเคลื่อนไม่ถึงเซนติเมตร
   */
  static distanceMeters(
    a: { latitude: number; longitude: number },
    b: { latitude: number; longitude: number },
  ): number {
    const EARTH_RADIUS_M = 6_371_000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
  }
}
