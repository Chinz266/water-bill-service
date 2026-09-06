import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** เริ่มสัญญาของผู้อยู่อาศัยรายใหม่ (ปิดรายเดิมให้อัตโนมัติถ้ายังค้างอยู่) */
export class StartTenancyDto {
  @ApiProperty({ description: 'ID ของบ้าน', example: 1 })
  members_id!: number;

  @ApiProperty({
    description: 'ชื่อ-นามสกุลผู้อยู่อาศัย',
    example: 'สมหญิง รักดี',
  })
  occupant_name!: string;

  @ApiPropertyOptional({ description: 'เบอร์ติดต่อ', example: '0812345678' })
  phone?: string;

  @ApiPropertyOptional({
    description: 'วันที่เริ่มอยู่ (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
    example: '2026-08-01',
  })
  start_date?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้บันทึก', example: 1 })
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
  members_id!: number;

  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  water_rates_id!: number;

  @ApiProperty({ description: 'เลขมิเตอร์ ณ วันย้ายออก', example: 1420 })
  current_unit!: number;

  @ApiPropertyOptional({
    description: 'วันที่ย้ายออก (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
    example: '2026-08-14',
  })
  moved_at?: string;

  @ApiPropertyOptional({
    description: 'ชื่อผู้อยู่อาศัยรายใหม่ (ถ้ามีคนเข้าอยู่ต่อทันที)',
  })
  new_occupant_name?: string;

  @ApiPropertyOptional({ description: 'เบอร์ติดต่อของผู้อยู่อาศัยรายใหม่' })
  new_occupant_phone?: string;

  @ApiPropertyOptional({ description: 'รูปหน้าปัดมิเตอร์เป็น data URL' })
  meter_photo?: string;

  @ApiPropertyOptional({
    description: 'ocr / manual / manual_after_ocr_fail — manual ต้องแนบรูปเสมอ',
    enum: ['ocr', 'manual', 'manual_after_ocr_fail'],
  })
  entry_method?: string;

  @ApiPropertyOptional({ description: 'จำนวนหลักที่ OCR อ่านได้' })
  meter_digits?: number;

  @ApiPropertyOptional({ description: 'ความมั่นใจของหลักที่อ่อนที่สุดจาก OCR' })
  read_confidence?: number;

  @ApiPropertyOptional({ description: 'ละติจูดของจุดที่ยืนถ่ายรูป' })
  latitude?: number;

  @ApiPropertyOptional({ description: 'ลองจิจูดของจุดที่ยืนถ่ายรูป' })
  longitude?: number;

  @ApiPropertyOptional({ description: 'ความคลาดเคลื่อนของพิกัดเป็นเมตร' })
  gps_accuracy_m?: number;

  @ApiPropertyOptional({ description: 'วันเวลาที่กดชัตเตอร์จริง (ISO 8601)' })
  captured_at?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้บันทึก' })
  create_by?: number;

  @ApiPropertyOptional({ description: 'ยืนยันหน่วยน้ำที่สูงผิดปกติ' })
  confirm_high_usage?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันการเปลี่ยนมิเตอร์/มิเตอร์วนรอบ' })
  confirm_meter_reset?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันจำนวนหลักที่เปลี่ยนไป' })
  confirm_digit_change?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันเลขที่ OCR อ่านได้ไม่ชัด' })
  confirm_low_confidence?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันรูปที่ถ่ายไว้นานเกิน 30 วัน' })
  confirm_stale_photo?: boolean;

  @ApiPropertyOptional({
    description:
      'จดทับบิลเดือนเดียวกันที่ออกไปแล้ว — ใช้เมื่อย้ายออกหลังจากออกบิลประจำเดือนไปแล้ว',
  })
  replace?: boolean;
}
