import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * จดมิเตอร์ + ออกบิล ในคำสั่งเดียว (หน้าสแกนมิเตอร์ใช้ตัวนี้)
 *
 * ⚠️ ตั้งใจไม่รับ previous_unit / usage_unit / total_amount จาก body
 *    ทั้งหมดหลังบ้านคำนวณเอง ไม่งั้นแก้ยอดเงินจากฝั่ง client ได้
 */
export class CreateBillFromScanDto {
  @ApiProperty({ description: 'ID ของบ้านที่จดมิเตอร์', example: 1 })
  members_id!: number;

  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  water_rates_id!: number;

  @ApiProperty({ description: 'เลขมิเตอร์ที่จดได้ครั้งนี้', example: 1250 })
  current_unit!: number;

  @ApiProperty({ description: 'บิลประจำเดือน (01-12)', example: '06' })
  billing_month!: string;

  @ApiProperty({ description: 'บิลประจำปี (ค.ศ.)', example: '2026' })
  billing_year!: string;

  @ApiPropertyOptional({
    description: 'วันที่จดมิเตอร์ (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
  })
  reading_date?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้จด', example: 1 })
  create_by?: number;

  @ApiPropertyOptional({
    description: 'ยืนยันจดทับบิลเดือนเดียวกันที่มีอยู่แล้ว (ลบใบเดิมทิ้งก่อน)',
    default: false,
  })
  replace?: boolean;

  @ApiPropertyOptional({
    description: 'ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้องจริง',
    default: false,
  })
  confirm_high_usage?: boolean;

  @ApiPropertyOptional({
    description:
      'รูปหน้าปัดมิเตอร์เป็น data URL (data:image/jpeg;base64,...) — ' +
      'เก็บเป็นไฟล์แล้วบันทึกเฉพาะ path ลง meter_readings.evidence_photo',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  meter_photo?: string;
}
