import { InputValue } from '../security/input-value';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ฝากรูปมิเตอร์ที่ยังออกบิลไม่ได้ไว้ในคิว ให้คนที่มีเวลาตรวจทีหลัง
 *
 * ใช้เมื่อคนเดินจดตัดสินใจหน้างานไม่ได้จริง ๆ:
 *   - OCR อ่านเลขไม่ออก (หน้าปัดฝ้า / โคลนบัง / แสงสะท้อน)
 *   - อ่านออกแต่ระบบเสนอหลายบ้านพอ ๆ กัน (confidence = ambiguous)
 *   - พิกัดไม่ตรงกับบ้านหลังไหนเลยในรัศมีที่เชื่อได้
 *   - **รู้แล้วว่าบ้านไหน แต่ด่านตีกลับ** (หน่วยพุ่ง / เลขต่ำกว่าเดือนก่อน / จดสลับตัว)
 *     แล้วคนหน้างานไม่กล้ากดยืนยันเอง → ส่ง `members_id` + `blocked_code` มาด้วย
 *
 * ดีกว่า "เดาแล้วกดไปก่อน" ซึ่งจบลงที่บิลผิดบ้าน และดีกว่า "ทิ้งรูปแล้วเดินกลับไปใหม่"
 */
export class CreateUnassignedReadingDto {
  @ApiProperty({
    description:
      'รูปหน้าปัดมิเตอร์เป็น data URL — **บังคับ** เพราะเป็นข้อมูลชิ้นเดียวที่ทำให้จับคู่ได้ทีหลัง',
    example: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
  })
  @InputValue('text', { maxLength: 3145728 })
  meter_photo!: string;

  @ApiPropertyOptional({
    description:
      'หมู่บ้านที่กำลังเดินจดตอนถ่าย — ช่วยจำกัดรายชื่อบ้านตอนจับคู่',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  villages_id?: number;

  @ApiPropertyOptional({
    description:
      'เลขที่ OCR อ่านได้ (ไม่ส่งมา = อ่านไม่ออก ให้ Admin เปิดรูปพิมพ์เอง)',
    example: 1250,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  meter_unit?: number;

  @ApiPropertyOptional({ description: 'จำนวนหลักที่ OCR ตรวจเจอ', example: 5 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  meter_digits?: number;

  @ApiPropertyOptional({
    description: 'ความมั่นใจของหลักที่อ่อนที่สุด',
    example: 0.62,
  })
  @InputValue('number', { min: 0, max: 1 })
  read_confidence?: number;

  @ApiPropertyOptional({
    description: 'ละติจูดของจุดที่ยืนถ่าย',
    example: 14.9799,
  })
  @InputValue('number', { min: -90, max: 90 })
  latitude?: number;

  @ApiPropertyOptional({
    description: 'ลองจิจูดของจุดที่ยืนถ่าย',
    example: 102.097771,
  })
  @InputValue('number', { min: -180, max: 180 })
  longitude?: number;

  @ApiPropertyOptional({
    description: 'ความคลาดเคลื่อนของพิกัดเป็นเมตร',
    example: 12,
  })
  @InputValue('number', { min: 0, max: 2147483647 })
  gps_accuracy_m?: number;

  @ApiPropertyOptional({ description: 'วันเวลาที่กดชัตเตอร์ (ISO 8601)' })
  @InputValue('text', { maxLength: 1000 })
  captured_at?: string;

  @ApiPropertyOptional({
    description:
      'บ้านที่คนหน้างานเลือกไว้แล้ว — ส่งมาเมื่อรูปเข้าคิวเพราะ**ด่านตีกลับ** ไม่ใช่เพราะไม่รู้ว่าของใคร ' +
      'คนตรวจจะได้ไม่ต้องไล่หาบ้านใหม่ (ยังเปลี่ยนบ้านตอนกดจับคู่ได้อยู่)',
    example: 12,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  members_id?: number;

  @ApiPropertyOptional({
    description:
      'รหัสด่านที่ตีกลับ (error code จาก POST /bills/scan เช่น HIGH_USAGE, METER_ROLLBACK, ' +
      'CLUSTER_SEQUENCE_MISMATCH) — หน้าตรวจใช้ค่านี้ตัดสินว่าจะขึ้นช่องยืนยันตัวไหนให้กด',
    example: 'HIGH_USAGE',
  })
  @InputValue('text', { maxLength: 1000 })
  blocked_code?: string;

  @ApiPropertyOptional({
    description:
      'ข้อความที่ด่านตอบกลับตอนนั้น — เก็บไว้ให้คนตรวจเห็นสิ่งเดียวกับที่คนหน้างานเห็น',
  })
  @InputValue('text', { maxLength: 1000 })
  blocked_reason?: string;

  @ApiPropertyOptional({
    description: 'บันทึกของคนถ่าย เช่น "หน้าปัดมีโคลนบัง"',
  })
  @InputValue('text', { maxLength: 5000 })
  note?: string;

  @ApiPropertyOptional({
    description: 'ID ของ Admin/พนักงานผู้ถ่าย',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by?: number;
}

/**
 * จับคู่ข้อมูลกำพร้ากับบ้าน แล้วออกบิล
 *
 * วิ่งผ่าน `POST /bills/scan` ตัวเดิมทั้งหมด ด่านกันข้อมูลผิดจึงยังทำงานครบ —
 * ปุ่ม confirm_* ทุกตัวจึงมีให้ใช้เหมือนกัน เผื่อโดนด่านไหนตีกลับ
 */
export class AssignUnassignedDto {
  @ApiPropertyOptional({
    description:
      'ID ของบ้านที่ตัดสินใจว่าเป็นเจ้าของรูปนี้ — ไม่ส่งมาจะใช้บ้านที่คนหน้างานเลือกไว้ (members_id ของแถว) ' +
      'ต้องมีอย่างน้อยหนึ่งทาง ไม่งั้นไม่รู้ว่าจะออกบิลให้ใคร',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  members_id?: number;

  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  water_rates_id!: number;

  @ApiProperty({ description: 'บิลประจำเดือน (01-12)', example: '08' })
  @InputValue('text', { maxLength: 1000 })
  billing_month!: string;

  @ApiProperty({ description: 'บิลประจำปี (ค.ศ.)', example: '2026' })
  @InputValue('text', { maxLength: 1000 })
  billing_year!: string;

  @ApiPropertyOptional({
    description:
      'เลขมิเตอร์ที่คนตรวจอ่านได้จากรูป — ส่งมาจะทับค่าที่ OCR อ่านไว้ ' +
      '(จำเป็นเมื่อ OCR อ่านไม่ออกตั้งแต่ต้น) และถือเป็นการกรอกมือ',
    example: 1250,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  current_unit?: number;

  @ApiPropertyOptional({
    description: 'วันที่จดมิเตอร์ (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
  })
  @InputValue('text', { maxLength: 1000 })
  reading_date?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้จับคู่', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by?: number;

  @ApiPropertyOptional({ description: 'จดทับบิลเดือนเดียวกันที่มีอยู่แล้ว' })
  @InputValue('boolean', {})
  replace?: boolean;

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
}
