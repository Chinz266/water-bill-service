/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
/**
 * ขนาดรวมของรูปทั้งชุดในหนึ่งคำขอ
 *
 * storage ด้านล่างเก็บ buffer ของทุกไฟล์ไว้ใน RAM พร้อมกัน ค่านี้จึงคือแรมที่หนึ่ง
 * คำขอกินได้จริง ไม่ใช่แค่ตัวเลขนโยบาย — ตั้งตาม MAX_FILES × ขีดสูงสุดต่อใบ (300 × 10 MB)
 * จะกิน 3 GB ต่อคำขอแล้วเซิร์ฟเวอร์ล้ม
 *
 * 100 MB มาจาก: หน้าเว็บย่อรูปเหลือ 800px ก่อนอัปอยู่แล้ว (ดู toUploadFile ฝั่ง Angular)
 * ซึ่งได้ใบละ 60-100 KB ทั้งชุด 300 ใบจึงอยู่ราว 20-30 MB — เผื่อไว้สามเท่าสำหรับ
 * เว็บเวอร์ชันเก่าที่ยังส่งรูปเต็มใบมา และรูปที่ย่อไม่สำเร็จจนต้องส่งต้นฉบับ
 *
 * ลูกบ้านที่ใช้เว็บเวอร์ชันย่อรูปแล้วจะไม่มีวันแตะเพดานนี้
 */
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const requestBytes = new WeakMap<object, number>();

export const imageUploadOptions: MulterOptions = {
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    fields: 30,
    // photo_meta ของ 300 ใบเป็น JSON ราว 40 KB — 64 KB เดิมพอดีเกินไปจนเสี่ยง
    fieldSize: 256 * 1024,
    // parts = ทุก field + ทุกไฟล์ในคำขอเดียว ต้องคลุม MAX_FILES (300) + fields (30)
    parts: 340,
  },
  storage: {
    _handleFile(request, file, callback) {
      let chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      file.stream.on('data', (chunk: Buffer) => {
        if (done) return;
        const total = (requestBytes.get(request) ?? 0) + chunk.length;
        requestBytes.set(request, total);
        if (total > MAX_BATCH_BYTES) {
          done = true;
          chunks = [];
          callback(
            new PayloadTooLargeException(
              'รูปทั้งหมดในหนึ่งคำขอต้องมีขนาดรวมไม่เกิน 32 MB',
            ),
          );
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      file.stream.once('error', (error: Error) => {
        if (!done) {
          done = true;
          chunks = [];
          callback(error);
        }
      });
      file.stream.once('end', () => {
        if (!done) {
          done = true;
          callback(null, { buffer: Buffer.concat(chunks), size });
        }
      });
    },
    _removeFile(_request, file, callback) {
      file.buffer = Buffer.alloc(0);
      callback(null);
    },
  },
};

/** Check actual image data, not the filename or client-supplied MIME type. */
export async function validateImage(file: Express.Multer.File): Promise<void> {
  if (file.buffer.length > MAX_IMAGE_BYTES) {
    throw new PayloadTooLargeException('รูปต้องมีขนาดไม่เกิน 10 MB');
  }
  try {
    const image = sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp', 'heif'].includes(metadata.format ?? ''))
      throw new Error('format');
    // Decode a thumbnail as well: a valid header alone does not prove a valid image.
    await image.resize(1, 1).toBuffer();
  } catch {
    throw new BadRequestException(
      'ไฟล์ต้องเป็นรูปภาพที่อ่านได้ และมีขนาดไม่เกิน 40 ล้านพิกเซล',
    );
  }
}
