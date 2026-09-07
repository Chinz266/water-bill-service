import { InputValue } from '../security/input-value';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWaterRateDto {
  @ApiProperty({
    description: 'ราคาค่าน้ำต่อหน่วย (บาท) รองรับทศนิยม 2 ตำแหน่ง',
    example: 15.0,
  })
  @InputValue('number', { min: 0, max: 2147483647 })
  price_per_unit!: number;

  @ApiProperty({
    description: 'สถานะการเปิดใช้งานเรทค่าน้ำ',
    enum: ['Active', 'Inactive'],
    default: 'Active',
    example: 'Active',
  })
  @InputValue('text', { maxLength: 1000 })
  status!: 'Active' | 'Inactive';

  @ApiProperty({
    description: 'ID ของ Admin ผู้ที่สร้างเรทค่าน้ำนี้',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by!: number;
}
