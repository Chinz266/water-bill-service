import { InputValue } from '../security/input-value';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVillageDto {
  @ApiProperty({
    description: 'ID ของจังหวัด (อ้างอิงจากตาราง provinces)',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  provinces_id!: number;

  @ApiProperty({
    description: 'ID ของอำเภอ (อ้างอิงจากตาราง districts)',
    example: 5,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  districts_id!: number;

  @ApiProperty({
    description: 'ID ของตำบล (อ้างอิงจากตาราง subdistricts)',
    example: 12,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  subdistricts_id!: number;

  @ApiPropertyOptional({
    description: 'รหัสไปรษณีย์ 5 หลัก',
    example: '30130',
  })
  @InputValue('text', { maxLength: 1000 })
  zip_code?: string;

  @ApiProperty({
    description: 'ชื่อหมู่บ้าน',
    example: 'หมู่บ้านจัดสรรอยู่สบาย',
  })
  @InputValue('text', { maxLength: 200 })
  village_name!: string;

  @ApiProperty({
    description: 'หมู่ที่',
    example: 'หมู่ 4',
  })
  @InputValue('text', { maxLength: 45 })
  village_no!: string;

  @ApiPropertyOptional({
    description: 'ชื่อผู้ใหญ่บ้าน',
    example: 'นายสมชาย ใจดี',
  })
  @InputValue('text', { maxLength: 45 })
  headman_name?: string;

  @ApiPropertyOptional({
    description: 'ชื่อผู้ช่วยผู้ใหญ่บ้าน',
    example: 'นายสมปอง รักสงบ',
  })
  @InputValue('text', { maxLength: 45 })
  deputy_headman_name?: string;

  @ApiPropertyOptional({
    description: 'เบอร์โทรศัพท์ติดต่อ',
    example: '0812345678',
  })
  @InputValue('text', { maxLength: 20 })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'ระยะเดินเฉลี่ยต่อ 1 มิเตอร์ เป็นเมตร — ชนบท/บ้านเดี่ยว 10-15, ทาวน์โฮม 4-8 ' +
      '(ไม่กรอก = ใช้ค่ากลาง 15) ใช้คำนวณรัศมีเตือน "ถ่ายห่างจากบ้านเกินไป" ตอนสแกนมิเตอร์',
    example: 12,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  meter_pitch_m?: number;

  @ApiProperty({
    description: 'ID ของ Admin ที่เป็นคนบันทึกข้อมูล',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by!: number;
}
