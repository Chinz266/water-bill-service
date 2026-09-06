/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_BATCH_BYTES = 32 * 1024 * 1024;
const requestBytes = new WeakMap<object, number>();

export const imageUploadOptions: MulterOptions = {
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    fields: 30,
    fieldSize: 64 * 1024,
    parts: 60,
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
