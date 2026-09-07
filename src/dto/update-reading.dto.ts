import { InputValue } from '../security/input-value';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * แก้เลขมิเตอร์ของบิลที่ออกไปแล้ว (PATCH /bills/:id/reading)
 *
 * ⚠️ ส่งเป็น multipart/form-data เพราะแนบรูปหน้าปัดใหม่มาด้วยได้ — ค่าทุกตัวที่มาถึง
 *    หลังบ้านจึงเป็น "สตริง" ทั้งหมด (`current_unit` เป็น '1250' ไม่ใช่ 1250 และ
 *    `confirm_high_usage` เป็น 'true' ไม่ใช่ true) BillsService.updateReading()
 *    เป็นคนแปลงค่าเอง ไม่ได้พึ่ง ValidationPipe ซึ่งโปรเจกต์นี้ยังไม่ได้เปิดใช้
 *
 * ⚠️ ตั้งใจไม่รับ usage_unit / total_amount — ยอดเงินคำนวณจากหลังบ้านเสมอ
 */
export class UpdateReadingDto {
  @ApiProperty({ description: 'เลขมิเตอร์ที่ถูกต้อง', example: 1250 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  current_unit!: string;

  @ApiProperty({
    description:
      'เหตุผลที่แก้ — **บังคับกรอก** เพราะการแก้ที่ไม่มีเหตุผลกำกับมีค่าเท่ากับไม่มีร่องรอย ' +
      '(เก็บลง meter_reading_logs.reason ไม่เกิน 500 ตัวอักษร)',
    example: 'OCR อ่านหลักสุดท้ายผิด เทียบกับรูปหน้าปัดแล้วเป็น 1250',
  })
  @InputValue('text', { maxLength: 1000 })
  reason!: string;

  @ApiPropertyOptional({
    description:
      'รูปหน้าปัดใหม่ (ไฟล์) — ไม่แนบมาก็ใช้รูปเดิมของการจดครั้งนั้นต่อ\n\n' +
      '⚠️ รูปนี้ผ่านการครอปจากหน้าเว็บมาแล้วจึงไม่มี EXIF — ระบบจึง **ไม่เอาไปอัปเดตพิกัด/เวลาถ่าย** ' +
      'ของการจดครั้งนั้นเลย ค่าพวกนั้นคงไว้ตามตอนที่เดินไปจดจริง',
    type: 'string',
    format: 'binary',
  })
  photo?: unknown;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าหน่วยน้ำที่สูงผิดปกติหลังแก้นั้นถูกต้องจริง — ' +
      'ส่งมาเฉพาะรอบที่ยิงหลังได้ 400 พร้อม code: "high_usage" เท่านั้น ห้ามติ๊กมาล่วงหน้า',
    default: false,
  })
  @InputValue('text', { maxLength: 1000 })
  confirm_high_usage?: string;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าเลขที่ต่ำกว่าเลขตั้งต้นเกิดจากการเปลี่ยนมิเตอร์/มิเตอร์วนรอบ — ' +
      'ส่งมาเฉพาะรอบที่ยิงหลังได้ 400 พร้อม code: "meter_reset" เท่านั้น ห้ามติ๊กมาล่วงหน้า',
    default: false,
  })
  @InputValue('text', { maxLength: 1000 })
  confirm_meter_reset?: string;
}
