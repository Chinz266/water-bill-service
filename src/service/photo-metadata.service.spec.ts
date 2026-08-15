import sharp from 'sharp';
import { PhotoMetadataService } from './photo-metadata.service';

/**
 * เทสต์ตัวอ่าน EXIF
 *
 * สร้างไฟล์ JPEG จริงด้วย sharp แล้วยัด EXIF เข้าไป จะได้ทดสอบกับไบต์จริง
 * ไม่ใช่ mock ตัว exifreader ซึ่งจะกลายเป็นการทดสอบ mock ของตัวเอง
 */
describe('PhotoMetadataService', () => {
  const service = new PhotoMetadataService();

  /** รูปเปล่า ๆ พร้อม EXIF ตามที่กำหนด */
  const jpegWith = (exif?: Record<string, Record<string, string>>) =>
    sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .jpeg()
      .withExif(exif ?? {})
      .toBuffer();

  it('อ่านวันเวลาที่ถ่ายจาก DateTimeOriginal ได้', async () => {
    const buffer = await jpegWith({
      IFD2: { DateTimeOriginal: '2026:08:14 10:23:45' },
    });

    const meta = service.read(buffer);

    expect(meta.has_exif).toBe(true);
    expect(meta.captured_at).not.toBeNull();
    // EXIF ไม่มี timezone จึงตีความเป็นเวลาท้องถิ่น
    expect(meta.captured_at?.getFullYear()).toBe(2026);
    expect(meta.captured_at?.getMonth()).toBe(7); // ส.ค. (นับจาก 0)
    expect(meta.captured_at?.getDate()).toBe(14);
    expect(meta.captured_at?.getHours()).toBe(10);
  });

  it('อ่านพิกัดเป็นทศนิยมพร้อมเครื่องหมายได้', async () => {
    const buffer = await jpegWith({
      IFD3: {
        GPSLatitude: '14/1 58/1 4776/100',
        GPSLatitudeRef: 'N',
        GPSLongitude: '102/1 5/1 5197/100',
        GPSLongitudeRef: 'E',
      },
    });

    const meta = service.read(buffer);

    expect(meta.latitude).toBeCloseTo(14.9799, 3);
    // 🌟 ลองจิจูดไทยเป็นเลข 3 หลัก — เคสเดียวกับที่ members.longitude เคยเก็บไม่ได้
    expect(meta.longitude).toBeCloseTo(102.0977, 3);
  });

  it('รูปที่ไม่มี EXIF (ผ่าน canvas/sharp มาแล้ว) → คืนค่าว่างโดยไม่ throw', async () => {
    const buffer = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .jpeg()
      .toBuffer();

    expect(service.read(buffer)).toEqual({
      has_exif: false,
      captured_at: null,
      latitude: null,
      longitude: null,
    });
  });

  it('ไฟล์ที่ไม่ใช่รูปเลย → คืนค่าว่างโดยไม่ throw', () => {
    const meta = service.read(Buffer.from('ไม่ใช่รูปภาพ'));

    expect(meta.has_exif).toBe(false);
    expect(meta.latitude).toBeNull();
  });

  it('buffer ว่าง → คืนค่าว่างโดยไม่ throw', () => {
    expect(service.read(Buffer.alloc(0)).has_exif).toBe(false);
  });

  describe('distanceMeters (Haversine)', () => {
    const KORAT = { latitude: 14.9799, longitude: 102.0977 };

    it('จุดเดียวกัน = 0 เมตร', () => {
      expect(PhotoMetadataService.distanceMeters(KORAT, KORAT)).toBe(0);
    });

    it('ห่าง 0.0001° ตามละติจูด ≈ 11 เมตร (ระยะห่างระหว่างบ้าน)', () => {
      const next = { latitude: 14.98, longitude: 102.0977 };

      const d = PhotoMetadataService.distanceMeters(KORAT, next);

      expect(d).toBeGreaterThan(10);
      expect(d).toBeLessThan(12);
    });

    it('วัดระยะไกลระดับกิโลเมตรได้ถูกต้อง', () => {
      const far = { latitude: 14.9899, longitude: 102.0977 };

      // 0.01° ละติจูด ≈ 1.11 กม.
      expect(PhotoMetadataService.distanceMeters(KORAT, far)).toBeCloseTo(
        1112,
        -2,
      );
    });
  });
});
