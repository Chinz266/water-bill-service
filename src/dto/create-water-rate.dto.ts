import { ApiProperty } from '@nestjs/swagger';

export class CreateWaterRateDto {
  @ApiProperty({
    description: 'ราคาค่าน้ำต่อหน่วย (บาท) รองรับทศนิยม 2 ตำแหน่ง',
    example: 15.00
  })
  price_per_unit!: number;

  @ApiProperty({
    description: 'สถานะการเปิดใช้งานเรทค่าน้ำ',
    enum: ['Active', 'Inactive'],
    default: 'Active',
    example: 'Active'
  })
  status!: 'Active' | 'Inactive';

  @ApiProperty({
    description: 'ID ของ Admin ผู้ที่สร้างเรทค่าน้ำนี้',
    example: 1
  })
  create_by!: number;
}