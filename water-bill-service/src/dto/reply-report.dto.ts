import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REPORT_STATUSES } from 'src/report/report.constants';
// ต้องเป็น `import type` เพราะ tsconfig เปิด isolatedModules + emitDecoratorMetadata ไว้
import type { ReportStatus } from 'src/report/report.constants';

/**
 * แอดมินตอบกลับเรื่อง และ/หรือ เปลี่ยนสถานะ
 * ส่งมาแค่อย่างใดอย่างหนึ่งก็ได้ (เช่นกดปิดเรื่องเฉย ๆ โดยไม่พิมพ์ตอบ)
 *
 * ⚠️ `replied_by` ไม่รับจาก body — อ่านจาก JWT ของแอดมินที่ล็อกอินอยู่
 *    (เหมือน modify_by ของหน้าตั้งค่าหมู่บ้าน ถ้ารับจาก body จะปลอมเป็นคนอื่นได้)
 */
export class ReplyReportDto {
  @ApiPropertyOptional({
    description: 'ข้อความตอบกลับถึงลูกบ้าน',
    example: 'ช่างเข้าไปตรวจแล้วครับ คาดว่าน้ำจะไหลปกติภายในเย็นนี้',
  })
  admin_reply?: string;

  @ApiPropertyOptional({
    description: 'สถานะการดำเนินการ',
    enum: REPORT_STATUSES,
    example: 'InProgress',
  })
  status?: ReportStatus;
}
