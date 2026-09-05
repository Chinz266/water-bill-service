import { InputValue } from '../security/input-value';
import { ApiProperty } from '@nestjs/swagger';

export class AdminCreateDto {
  @ApiProperty({ description: 'ID of the admin', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  id!: number;

  @ApiProperty({ description: 'First name of the admin', example: 'John' })
  @InputValue('text', { maxLength: 45 })
  fname!: string;

  @ApiProperty({ description: 'Last name of the admin', example: 'Doe' })
  @InputValue('text', { maxLength: 45 })
  lname!: string;

  @ApiProperty({
    description: 'Phone number of the admin',
    example: '0812345678',
  })
  @InputValue('text', { maxLength: 20 })
  phone!: string;

  @ApiProperty({ description: 'Password of the admin', example: 'password123' })
  @InputValue('text', { maxLength: 1000 })
  password!: string;

  /**
   * @deprecated ไม่ถูกใช้แล้ว — ตาราง admin ไม่มีคอลัมน์ role ตั้งแต่แยก accounts ออกไป
   * ยังรับไว้เฉย ๆ เพื่อไม่ให้ client รุ่นเก่าที่ยังส่งมาพัง (ค่าจะถูกทิ้ง)
   */
  @ApiProperty({ description: 'ไม่ใช้แล้ว', required: false })
  @InputValue('text', { maxLength: 1000 })
  role?: string;

  @ApiProperty({
    description:
      'รูปโปรไฟล์แบบ base64 data URL (ย่อขนาดจากฝั่งเว็บแล้ว) หรือ null เพื่อลบรูป',
    required: false,
  })
  @InputValue('text', { maxLength: 3145728 })
  photo?: string | null;
}
