import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMeterReadingDto {
  @ApiProperty({ description: 'วันที่ไปจดมิเตอร์ (YYYY-MM-DD)', example: '2026-06-23' })
  reading_date!: string;

  @ApiProperty({ description: 'หน่วยค่าน้ำที่จดได้ (เลขบนมิเตอร์)', example: 1250 })
  meter_unit!: number;

  @ApiPropertyOptional({ description: 'ชื่อไฟล์หรือ URL รูปถ่ายหลักฐาน', example: 'meter_home_1_jun.jpg' })
  evidence_photo?: string;

  @ApiProperty({ description: 'ID ของลูกบ้าน (เจ้าของมิเตอร์)', example: 1 })
  members_id!: number;

  @ApiProperty({ description: 'ID ของพนักงาน/Admin ที่จดข้อมูล', example: 1 })
  create_by!: number;
}