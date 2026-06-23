import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMemberDto {
  @ApiProperty({ description: 'ชื่อจริง', example: 'สมชาย' })
  fname!: string;

  @ApiProperty({ description: 'นามสกุล', example: 'ใจดี' })
  lname!: string;

  @ApiProperty({ description: 'บ้านเลขที่', example: '99/9' })
  house_no!: string;

  @ApiPropertyOptional({ description: 'เบอร์โทรศัพท์', example: '0812345678' })
  phone?: string;

  @ApiPropertyOptional({ description: 'ละติจูด (พิกัดแผนที่บ้าน)', example: 14.979900 })
  latitude?: number;

  @ApiPropertyOptional({ description: 'ลองจิจูด (พิกัดแผนที่บ้าน)', example: 102.097771 })
  longitude?: number;

  @ApiProperty({ description: 'ID ของหมู่บ้านที่ลูกบ้านอาศัยอยู่', example: 1 })
  villages_id!: number;

  @ApiProperty({ description: 'ID ของ Admin ผู้บันทึกข้อมูล', example: 1 })
  create_by!: number;
}