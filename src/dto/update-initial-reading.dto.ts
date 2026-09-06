import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * แก้เลขมิเตอร์ตั้งต้นของบ้านที่ลงทะเบียนไปแล้ว (POST /member/initial-reading)
 *
 * เลขตั้งต้นคือเส้นเริ่มต้นที่บิลใบแรกเอาไปลบ พิมพ์ผิดหลักเดียวทุกบิลของบ้านหลังนั้น
 * ผิดตามไปหมด — ของเดิมแก้ไม่ได้เลย ต้องลบบ้านทิ้งแล้วลงใหม่ ซึ่งพาบิลกับประวัติ
 * การจดหายไปด้วย
 */
export class UpdateInitialReadingDto {
  @ApiProperty({ description: 'ID ของลูกบ้านที่จะแก้เลขตั้งต้น', example: 12 })
  id!: number;

  @ApiProperty({
    description: 'เลขมิเตอร์ตั้งต้นที่ถูกต้อง — จำนวนเต็มไม่ติดลบ',
    example: 1250,
  })
  initial_meter_unit!: number;

  @ApiProperty({
    description:
      'เหตุผลที่แก้ — **บังคับกรอก** เพราะการแก้นี้กระทบทุกบิลของบ้านหลังนี้ ' +
      'การแก้ที่ไม่มีเหตุผลกำกับมีค่าเท่ากับไม่มีร่องรอย (เก็บลง meter_reading_logs.reason ไม่เกิน 500 ตัวอักษร)',
    example: 'ตอนลงทะเบียนพิมพ์เกินหนึ่งหลัก เทียบกับรูปหน้าปัดแล้วเป็น 1250',
  })
  reason!: string;

  @ApiPropertyOptional({
    description: 'admin.id ของคนที่แก้ — เก็บลง log ไว้ตามรอยย้อนหลัง',
    example: 1,
  })
  changed_by?: number;
}
