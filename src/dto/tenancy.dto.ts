import { InputValue } from '../security/input-value';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** เริ่มสัญญาของผู้อยู่อาศัยรายใหม่ (ปิดรายเดิมให้อัตโนมัติถ้ายังค้างอยู่) */
export class StartTenancyDto {
  @ApiProperty({ description: 'ID ของบ้าน', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  members_id!: number;

  @ApiProperty({
    description: 'ชื่อ-นามสกุลผู้อยู่อาศัย',
    example: 'สมหญิง รักดี',
  })
  @InputValue('text', { maxLength: 1000 })
  occupant_name!: string;

  @ApiPropertyOptional({ description: 'เบอร์ติดต่อ', example: '0812345678' })
  @InputValue('text', { maxLength: 20 })
  phone?: string;

  @ApiPropertyOptional({
    description: 'วันที่เริ่มอยู่ (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
    example: '2026-08-01',
  })
  @InputValue('text', { maxLength: 1000 })
  start_date?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้บันทึก', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by?: number;
}

/**
 * ย้ายออก — จดมิเตอร์ครั้งสุดท้าย + ออกบิลปิดยอด ณ วันย้ายออก
 *
 * บิลที่ได้ต่างจากบิลประจำเดือนสองอย่าง:
 *   1. `due_date` = วันย้ายออกเลย ไม่ยืดตามรอบชำระของหมู่บ้าน (ย้ายไปแล้วตามเก็บไม่ได้)
 *   2. ทบยอดค้างเก่าทั้งหมดเข้าใบนี้ เพราะเป็นใบสุดท้ายที่เรียกเก็บจากคนนี้ได้
 *      ถ้าไม่ทบ ยอดจะตกไปอยู่กับผู้เช่าคนถัดไปที่ไม่ได้ใช้น้ำก้อนนั้นเลย
 *
 * ด่านกันข้อมูลผิดทุกด่านของ POST /bills/scan ยังทำงานครบเหมือนเดิม
 */
export class MoveOutDto {
  @ApiProperty({ description: 'ID ของบ้าน', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  members_id!: number;

  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  water_rates_id!: number;

  @ApiProperty({ description: 'เลขมิเตอร์ ณ วันย้ายออก', example: 1420 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  current_unit!: number;

  @ApiPropertyOptional({
    description: 'วันที่ย้ายออก (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
    example: '2026-08-14',
  })
  @InputValue('text', { maxLength: 1000 })
  moved_at?: string;

  @ApiPropertyOptional({
    description: 'ชื่อผู้อยู่อาศัยรายใหม่ (ถ้ามีคนเข้าอยู่ต่อทันที)',
  })
  @InputValue('text', { maxLength: 1000 })
  new_occupant_name?: string;

  @ApiPropertyOptional({ description: 'เบอร์ติดต่อของผู้อยู่อาศัยรายใหม่' })
  @InputValue('text', { maxLength: 20 })
  new_occupant_phone?: string;

  @ApiPropertyOptional({ description: 'รูปหน้าปัดมิเตอร์เป็น data URL' })
  @InputValue('text', { maxLength: 3145728 })
  meter_photo?: string;

  @ApiPropertyOptional({
    description: 'ocr / manual / manual_after_ocr_fail — manual ต้องแนบรูปเสมอ',
    enum: ['ocr', 'manual', 'manual_after_ocr_fail'],
  })
  @InputValue('text', { maxLength: 1000 })
  entry_method?: string;

  @ApiPropertyOptional({ description: 'จำนวนหลักที่ OCR อ่านได้' })
  @InputValue('integer', { min: 0, max: 2147483647 })
  meter_digits?: number;

  @ApiPropertyOptional({ description: 'ความมั่นใจของหลักที่อ่อนที่สุดจาก OCR' })
  @InputValue('number', { min: 0, max: 1 })
  read_confidence?: number;

  @ApiPropertyOptional({ description: 'ละติจูดของจุดที่ยืนถ่ายรูป' })
  @InputValue('number', { min: -90, max: 90 })
  latitude?: number;

  @ApiPropertyOptional({ description: 'ลองจิจูดของจุดที่ยืนถ่ายรูป' })
  @InputValue('number', { min: -180, max: 180 })
  longitude?: number;

  @ApiPropertyOptional({ description: 'ความคลาดเคลื่อนของพิกัดเป็นเมตร' })
  @InputValue('number', { min: 0, max: 2147483647 })
  gps_accuracy_m?: number;

  @ApiPropertyOptional({ description: 'วันเวลาที่กดชัตเตอร์จริง (ISO 8601)' })
  @InputValue('text', { maxLength: 1000 })
  captured_at?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้บันทึก' })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by?: number;

  @ApiPropertyOptional({ description: 'ยืนยันหน่วยน้ำที่สูงผิดปกติ' })
  @InputValue('boolean', {})
  confirm_high_usage?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันการเปลี่ยนมิเตอร์/มิเตอร์วนรอบ' })
  @InputValue('boolean', {})
  confirm_meter_reset?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันจำนวนหลักที่เปลี่ยนไป' })
  @InputValue('boolean', {})
  confirm_digit_change?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันเลขที่ OCR อ่านได้ไม่ชัด' })
  @InputValue('boolean', {})
  confirm_low_confidence?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันพิกัดที่ซ้ำกับการจดครั้งก่อน' })
  @InputValue('boolean', {})
  confirm_duplicate_location?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันรูปที่ถ่ายไว้นานเกิน 30 วัน' })
  @InputValue('boolean', {})
  confirm_stale_photo?: boolean;

  @ApiPropertyOptional({
    description:
      'จดทับบิลเดือนเดียวกันที่ออกไปแล้ว — ใช้เมื่อย้ายออกหลังจากออกบิลประจำเดือนไปแล้ว',
  })
  @InputValue('boolean', {})
  replace?: boolean;
}
