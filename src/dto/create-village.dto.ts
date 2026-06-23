import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVillageDto {
  @ApiProperty({ 
    description: 'ID ของจังหวัด (อ้างอิงจากตาราง provinces)',
    example: 1 
  })
  provinces_id!: number;

  @ApiProperty({ 
    description: 'ID ของอำเภอ (อ้างอิงจากตาราง districts)',
    example: 5 
  })
  districts_id!: number;

  @ApiProperty({ 
    description: 'ID ของตำบล (อ้างอิงจากตาราง subdistricts)',
    example: 12 
  })
  subdistricts_id!: number;

  @ApiProperty({ 
    description: 'ชื่อหมู่บ้าน',
    example: 'หมู่บ้านจัดสรรอยู่สบาย' 
  })
  village_name!: string;

  @ApiProperty({ 
    description: 'หมู่ที่',
    example: 'หมู่ 4' 
  })
  village_no!: string;

  @ApiPropertyOptional({ 
    description: 'ชื่อผู้ใหญ่บ้าน',
    example: 'นายสมชาย ใจดี' 
  })
  headman_name?: string;

  @ApiPropertyOptional({ 
    description: 'ชื่อผู้ช่วยผู้ใหญ่บ้าน',
    example: 'นายสมปอง รักสงบ' 
  })
  deputy_headman_name?: string;

  @ApiPropertyOptional({ 
    description: 'เบอร์โทรศัพท์ติดต่อ',
    example: '0812345678' 
  })
  phone?: string;

  @ApiProperty({ 
    description: 'ID ของ Admin ที่เป็นคนบันทึกข้อมูล',
    example: 1 
  })
  create_by!: number;
}