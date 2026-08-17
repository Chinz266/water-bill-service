import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ฝากรูปมิเตอร์ที่ยังไม่รู้ว่าของบ้านไหนไว้ในคิว (ข้อมูลกำพร้า)
 *
 * ใช้เมื่อคนเดินจดตัดสินใจหน้างานไม่ได้จริง ๆ:
 *   - OCR อ่านเลขไม่ออก (หน้าปัดฝ้า / โคลนบัง / แสงสะท้อน)
 *   - อ่านออกแต่ระบบเสนอหลายบ้านพอ ๆ กัน (confidence = ambiguous)
 *   - พิกัดไม่ตรงกับบ้านหลังไหนเลยในรัศมีที่เชื่อได้
 *
 * ดีกว่า "เดาแล้วกดไปก่อน" ซึ่งจบลงที่บิลผิดบ้าน และดีกว่า "ทิ้งรูปแล้วเดินกลับไปใหม่"
 */
export class CreateUnassignedReadingDto {
  @ApiProperty({
    description:
      'รูปหน้าปัดมิเตอร์เป็น data URL — **บังคับ** เพราะเป็นข้อมูลชิ้นเดียวที่ทำให้จับคู่ได้ทีหลัง',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  meter_photo!: string;

  @ApiPropertyOptional({
    description:
      'หมู่บ้านที่กำลังเดินจดตอนถ่าย — ช่วยจำกัดรายชื่อบ้านตอนจับคู่',
    example: 1,
  })
  villages_id?: number;

  @ApiPropertyOptional({
    description:
      'เลขที่ OCR อ่านได้ (ไม่ส่งมา = อ่านไม่ออก ให้ Admin เปิดรูปพิมพ์เอง)',
    example: 1250,
  })
  meter_unit?: number;

  @ApiPropertyOptional({ description: 'จำนวนหลักที่ OCR ตรวจเจอ', example: 5 })
  meter_digits?: number;

  @ApiPropertyOptional({
    description: 'ความมั่นใจของหลักที่อ่อนที่สุด',
    example: 0.62,
  })
  read_confidence?: number;

  @ApiPropertyOptional({
    description: 'ละติจูดของจุดที่ยืนถ่าย',
    example: 14.9799,
  })
  latitude?: number;

  @ApiPropertyOptional({
    description: 'ลองจิจูดของจุดที่ยืนถ่าย',
    example: 102.097771,
  })
  longitude?: number;

  @ApiPropertyOptional({
    description: 'ความคลาดเคลื่อนของพิกัดเป็นเมตร',
    example: 12,
  })
  gps_accuracy_m?: number;

  @ApiPropertyOptional({ description: 'วันเวลาที่กดชัตเตอร์ (ISO 8601)' })
  captured_at?: string;

  @ApiPropertyOptional({
    description: 'บันทึกของคนถ่าย เช่น "หน้าปัดมีโคลนบัง"',
  })
  note?: string;

  @ApiPropertyOptional({
    description: 'ID ของ Admin/พนักงานผู้ถ่าย',
    example: 1,
  })
  create_by?: number;
}

/**
 * จับคู่ข้อมูลกำพร้ากับบ้าน แล้วออกบิล
 *
 * วิ่งผ่าน `POST /bills/scan` ตัวเดิมทั้งหมด ด่านกันข้อมูลผิดจึงยังทำงานครบ —
 * ปุ่ม confirm_* ทุกตัวจึงมีให้ใช้เหมือนกัน เผื่อโดนด่านไหนตีกลับ
 */
export class AssignUnassignedDto {
  @ApiProperty({
    description: 'ID ของบ้านที่ตัดสินใจว่าเป็นเจ้าของรูปนี้',
    example: 1,
  })
  members_id!: number;

  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  water_rates_id!: number;

  @ApiProperty({ description: 'บิลประจำเดือน (01-12)', example: '08' })
  billing_month!: string;

  @ApiProperty({ description: 'บิลประจำปี (ค.ศ.)', example: '2026' })
  billing_year!: string;

  @ApiPropertyOptional({
    description:
      'เลขมิเตอร์ที่คนตรวจอ่านได้จากรูป — ส่งมาจะทับค่าที่ OCR อ่านไว้ ' +
      '(จำเป็นเมื่อ OCR อ่านไม่ออกตั้งแต่ต้น) และถือเป็นการกรอกมือ',
    example: 1250,
  })
  current_unit?: number;

  @ApiPropertyOptional({
    description: 'วันที่จดมิเตอร์ (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
  })
  reading_date?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้จับคู่', example: 1 })
  create_by?: number;

  @ApiPropertyOptional({ description: 'จดทับบิลเดือนเดียวกันที่มีอยู่แล้ว' })
  replace?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันหน่วยน้ำที่สูงผิดปกติ' })
  confirm_high_usage?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันการเปลี่ยนมิเตอร์/มิเตอร์วนรอบ' })
  confirm_meter_reset?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันจำนวนหลักที่เปลี่ยนไป' })
  confirm_digit_change?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันเลขที่ OCR อ่านได้ไม่ชัด' })
  confirm_low_confidence?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันพิกัดที่ซ้ำกับการจดครั้งก่อน' })
  confirm_duplicate_location?: boolean;

  @ApiPropertyOptional({ description: 'ยืนยันรูปที่ถ่ายไว้นานเกิน 30 วัน' })
  confirm_stale_photo?: boolean;
}
