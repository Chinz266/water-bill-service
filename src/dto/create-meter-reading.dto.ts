import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined } from 'class-validator';

export class CreateMeterReadingDto {
  // ตรวจแค่ "ส่งมาหรือเปล่า" ไม่ตรวจชนิด — เหตุผลเดียวกับ CreateBillDto
  @IsDefined({ message: 'ต้องระบุ reading_date (วันที่จดมิเตอร์)' })
  @ApiProperty({
    description: 'วันที่ไปจดมิเตอร์ (YYYY-MM-DD)',
    example: '2026-06-23',
  })
  reading_date!: string;

  @IsDefined({ message: 'ต้องระบุ meter_unit (เลขบนมิเตอร์)' })
  @ApiProperty({
    description: 'หน่วยค่าน้ำที่จดได้ (เลขบนมิเตอร์)',
    example: 1250,
  })
  meter_unit!: number;

  @ApiPropertyOptional({
    description: 'ชื่อไฟล์หรือ URL รูปถ่ายหลักฐาน',
    example: 'meter_home_1_jun.jpg',
  })
  evidence_photo?: string;

  @IsDefined({ message: 'ต้องระบุ members_id (ID ของลูกบ้าน)' })
  @ApiProperty({ description: 'ID ของลูกบ้าน (เจ้าของมิเตอร์)', example: 1 })
  members_id!: number;

  @ApiPropertyOptional({
    description: 'ID ของพนักงาน/Admin ที่จดข้อมูล',
    example: 1,
  })
  create_by?: number;
}
