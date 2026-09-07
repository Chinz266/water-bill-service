import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';

/**
 * เก็บรูปหน้าปัดมิเตอร์ที่ถ่ายตอนจดเลข
 *
 * เก็บเป็น "ไฟล์บนดิสก์ + path ใน DB" ไม่ใช่ base64 ในคอลัมน์ เพราะ:
 *   - คอลัมน์ evidence_photo เป็น varchar(1000) ตั้งใจให้เก็บ path มาตั้งแต่ออกแบบตาราง
 *     ยัด base64 ลงไปต้อง ALTER เป็น LONGTEXT ซึ่ง synchronize:false = ต้องเขียน migration เอง
 *   - รูปมิเตอร์เกิดทุกเดือน × ทุกบ้าน ถ้าอยู่ใน DB ทุกครั้งที่เรียก GET /bills
 *     จะลากรูปทุกใบมาด้วย (หน้าประวัติบิลโหลดทีเดียวทั้งหมู่บ้าน) — ช้าขึ้นเรื่อย ๆ ตามอายุระบบ
 */
@Injectable()
export class MeterPhotoService {
  private readonly logger = new Logger(MeterPhotoService.name);

  /** โฟลเดอร์จริงบนดิสก์ (อยู่นอก src ไม่ถูก nest build ทับ) */
  private readonly dir = join(process.cwd(), 'uploads', 'meters');

  /** path ที่เว็บเรียกได้ — ต้องตรงกับ prefix ของ useStaticAssets ใน main.ts */
  private static readonly URL_PREFIX = '/uploads/meters/';

  /**
   * เพดานขนาด data URL ที่ยอมรับ (3 MB)
   * หน้าเว็บย่อรูปมาให้แล้วเหลือหลักสิบ KB ถ้าเกินนี้คือมีอะไรผิด
   * ไม่ควรปล่อยให้ decode ก้อนมหึมาแล้วกิน RAM ของ server ฟรี ๆ
   */
  private static readonly MAX_DATA_URL_LENGTH = 3 * 1024 * 1024;

  /**
   * บันทึกรูปจาก data URL ที่หน้าเว็บส่งมา → คืน path ที่เอาไปเก็บใน DB
   *
   * ผ่าน sharp อีกชั้นเสมอ ไม่ได้เขียน buffer ที่รับมาลงดิสก์ตรง ๆ เพราะ
   * เท่ากับรับไฟล์อะไรก็ไม่รู้จากฝั่ง client มาวางไว้ในโฟลเดอร์ที่เสิร์ฟเป็น static
   * ถ้าไม่ใช่รูปจริง sharp จะโยน error ทิ้งตั้งแต่ตรงนี้ และได้ .jpg ที่สะอาดขนาดคุมได้ด้วย
   */
  async save(dataUrl: string, membersId: number): Promise<string> {
    if (dataUrl.length > MeterPhotoService.MAX_DATA_URL_LENGTH) {
      throw new BadRequestException('รูปมิเตอร์มีขนาดใหญ่เกินไป');
    }

    const match = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(dataUrl.trim());
    if (!match) {
      throw new BadRequestException('รูปมิเตอร์ที่ส่งมาไม่ใช่รูปภาพที่อ่านได้');
    }

    let jpeg: Buffer;
    try {
      jpeg = await sharp(Buffer.from(match[1], 'base64'))
        // rotate() ที่ไม่ใส่องศา = หมุนตาม EXIF ของกล้องมือถือ แล้วลบ EXIF ทิ้ง
        // ไม่ทำแล้วรูปจากบางรุ่นจะตะแคงเวลาเปิดดูบนเว็บ ทั้งที่ตอนถ่ายเห็นตรง
        .rotate()
        .resize({
          width: 800,
          height: 800,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 60 })
        .toBuffer();
    } catch (error) {
      this.logger.warn(`แปลงรูปมิเตอร์ไม่ได้: ${(error as Error).message}`);
      throw new BadRequestException('รูปมิเตอร์ที่ส่งมาไม่ใช่รูปภาพที่อ่านได้');
    }

    await mkdir(this.dir, { recursive: true });

    // สุ่มชื่อไฟล์ เพราะโฟลเดอร์นี้เสิร์ฟแบบไม่ต้องมี token (แท็ก <img> แนบ Bearer ไม่ได้)
    // ชื่อที่เดาได้เช่น bill-12.jpg เท่ากับใครก็ไล่ดูรูปมิเตอร์ทั้งหมู่บ้านได้จากข้างนอก
    const name = `${Date.now()}-${membersId}-${randomBytes(8).toString('hex')}.jpg`;
    await writeFile(join(this.dir, name), jpeg);

    return MeterPhotoService.URL_PREFIX + name;
  }

  /**
   * อ่านไฟล์ที่เก็บไว้แล้วกลับมาเป็น data URL — null เมื่อไฟล์หายหรือ path ใช้ไม่ได้
   *
   * ═══ ใช้ตอนไหน ═══
   *
   * ตอนจับคู่ข้อมูลกำพร้า รูปถูกเขียนลงดิสก์ไปตั้งแต่รอบก่อนแล้ว แต่ทางออกบิล
   * (`createFromScan`) รับรูปเป็น data URL เท่านั้น เพราะมันต้องผ่าน sharp เองเพื่อกัน
   * ไฟล์ที่ไม่ใช่รูปจริงถูกวางไว้ในโฟลเดอร์ที่เสิร์ฟเป็น static
   *
   * ยอมจ่ายค่าอ่านไฟล์หนึ่งรอบ ดีกว่าเปิดทางให้ส่ง path เข้าไปตรง ๆ ซึ่งจะข้ามชั้นนั้น
   * ไปทั้งชั้น (และเปิดช่องให้ path ที่มี ../ พาไปหยิบไฟล์อื่นในเครื่อง)
   */
  async toDataUrl(
    storedPath: string | null | undefined,
  ): Promise<string | null> {
    if (!storedPath?.startsWith(MeterPhotoService.URL_PREFIX)) return null;

    const name = storedPath.slice(MeterPhotoService.URL_PREFIX.length);
    // กัน path traversal ด้วยกฎเดียวกับ remove() — ชื่อไฟล์ที่เราตั้งเองเท่านั้น
    if (!/^[\w.-]+$/.test(name)) return null;

    try {
      const buffer = await readFile(join(this.dir, name));
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
      this.logger.warn(
        `อ่านไฟล์รูป ${name} ไม่ได้: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * ลบไฟล์รูปทิ้งเมื่อการจดมิเตอร์ที่อ้างถึงมันถูกลบ (จดทับ / ลบบิล)
   *
   * best-effort — ลบไม่ได้ก็แค่มีไฟล์ค้าง ไม่ควรทำให้คำสั่งลบบิลพังตามไปด้วย
   * ตัดชื่อไฟล์ออกจาก path เองก่อนใช้ กัน path จาก DB ที่มี ../ พาไปลบไฟล์อื่น
   */
  async remove(storedPath: string | null | undefined): Promise<void> {
    if (!storedPath?.startsWith(MeterPhotoService.URL_PREFIX)) return;

    const name = storedPath.slice(MeterPhotoService.URL_PREFIX.length);
    if (!/^[\w.-]+$/.test(name)) return;

    try {
      await unlink(join(this.dir, name));
    } catch (error) {
      const err = error as { code?: string; message?: string };
      // ไฟล์หายไปแล้วถือว่าสำเร็จตามเจตนา ไม่ต้องรายงาน
      if (err.code !== 'ENOENT') {
        this.logger.warn(`ลบรูปมิเตอร์ ${name} ไม่สำเร็จ: ${err.message}`);
      }
    }
  }
}
