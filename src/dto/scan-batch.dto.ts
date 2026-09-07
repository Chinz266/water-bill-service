import { InputValue } from '../security/input-value';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * อัปรูปมิเตอร์หลายใบพร้อมกัน เพื่อให้ระบบเดาว่ารูปไหนเป็นของบ้านหลังไหน
 *
 * ⚠️ endpoint นี้ **ไม่เขียนอะไรลงฐานข้อมูลเลย** — อ่านรูป เดาบ้าน แล้วคืนผลให้คนตรวจ
 *    การออกบิลจริงยังต้องยิง POST /bills/scan ทีละหลังหลังจากคนกดยืนยันแล้ว
 *    เพราะด่านกันข้อมูลผิดทั้งหมด (บิลซ้ำ, เลขต่ำกว่าเดือนก่อน, หน่วยพุ่ง) อยู่ที่นั่น
 */
export class ScanBatchDto {
  @ApiProperty({ description: 'บิลประจำเดือนที่จะออก (01-12)', example: '08' })
  @InputValue('text', { maxLength: 1000 })
  billing_month!: string;

  @ApiProperty({ description: 'บิลประจำปี (ค.ศ.)', example: '2026' })
  @InputValue('text', { maxLength: 1000 })
  billing_year!: string;

  @ApiPropertyOptional({
    description:
      'จำกัดบ้านที่จะเอามาจับคู่เฉพาะหมู่บ้านนี้ — ' +
      'ไม่ส่งมาจะเทียบกับบ้านทุกหลังในระบบ ซึ่งเพิ่มโอกาสจับคู่ผิดโดยไม่จำเป็น',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  villages_id?: number;

  @ApiPropertyOptional({
    description:
      'วันถ่ายกับพิกัดที่ฝั่งเว็บอ่านจาก EXIF ของ**ไฟล์ต้นฉบับ**ก่อนย่อรูป — ' +
      'JSON array เรียงตรงลำดับกับ files (index ตรงกัน ใบที่ไม่มีข้อมูลใส่ null ไว้) ' +
      'ใช้เมื่อไฟล์ที่อัปมาไม่มี EXIF เหลือแล้ว เพราะถูกย่อผ่าน canvas ซึ่งเก็บแต่พิกเซล ' +
      '⚠️ ค่านี้มาจากฝั่งผู้ใช้ ปลอมได้ — ระบบจึงคง has_exif เป็น false ไว้เสมอเมื่อใช้ค่านี้ ' +
      'เพื่อให้ด่านที่ต้องการหลักฐานจากตัวไฟล์แยกออกว่าค่าไหนเชื่อถือได้แค่ไหน',
    example:
      '[{"captured_at":"2026-09-07T03:12:44.000Z","latitude":14.98339,"longitude":102.09771}]',
  })
  @InputValue('text', { maxLength: 100000 })
  photo_meta?: string;
}
