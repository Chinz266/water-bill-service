import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REPORT_CATEGORIES } from 'src/report/report.constants';
// ต้องเป็น `import type` เพราะ tsconfig เปิด isolatedModules + emitDecoratorMetadata ไว้
import type { ReportCategory } from 'src/report/report.constants';

/**
 * เรื่องที่ลูกบ้านส่งเข้ามา
 *
 * ⚠️ ตั้งใจไม่รับ `account_id` และ `status` จาก body
 *    - account_id อ่านจาก JWT ของคนที่ล็อกอินอยู่ (ถ้ารับจาก body จะแจ้งแทนคนอื่นได้)
 *    - status เป็นงานของแอดมิน เรื่องที่เพิ่งส่งต้องเป็น 'Pending' เสมอ
 */
export class CreateReportDto {
  @ApiProperty({
    description: 'ID ของบ้านที่เรื่องนี้อ้างถึง (ต้องเป็นบ้านที่บัญชีนี้ดูแล)',
    example: 1,
  })
  members_id!: number;

  @ApiProperty({
    description: 'หมวดหมู่เรื่อง',
    enum: REPORT_CATEGORIES,
    example: 'WATER_OUT',
  })
  category!: ReportCategory;

  @ApiProperty({
    description: 'รายละเอียดที่ลูกบ้านพิมพ์เอง',
    example: 'น้ำไม่ไหลตั้งแต่เมื่อคืน ทั้งซอยเป็นเหมือนกันครับ',
  })
  detail!: string;

  @ApiPropertyOptional({
    description: 'รูปประกอบแบบ base64 data URL (ย่อขนาดจากฝั่งเว็บแล้ว)',
  })
  photo?: string | null;
}
