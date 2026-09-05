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
}
