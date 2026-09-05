import { InputValue } from '../security/input-value';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ข้อมูลหมู่บ้านที่แก้ไขได้จากหน้าตั้งค่า (admin เท่านั้น)
 *
 * 🌟 ทุกฟิลด์เป็น optional เพราะหน้าเว็บอาจส่งมาแค่ฟิลด์ที่แก้จริง
 *
 * ⚠️ ตั้งใจไม่ใส่ `create_by` และ `id` ไว้ในนี้
 *    - `id` มาจาก URL ไม่ใช่ body
 *    - `create_by` คือคนสร้างครั้งแรก ห้ามให้แก้ย้อนหลัง
 *    - `modify_by` ก็ไม่รับจาก body เช่นกัน แต่อ่านจาก JWT ของคนที่ล็อกอินอยู่
 *      (ถ้ารับจาก body ผู้ใช้จะปลอมเป็น id คนอื่นได้)
 */
export class UpdateVillageDto {
  @ApiPropertyOptional({
    description: 'ID ของจังหวัด (อ้างอิงตาราง provinces)',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  provinces_id?: number;

  @ApiPropertyOptional({
    description: 'ID ของอำเภอ (อ้างอิงตาราง districts)',
    example: 5,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  districts_id?: number;

  @ApiPropertyOptional({
    description: 'ID ของตำบล (อ้างอิงตาราง subdistricts)',
    example: 12,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  subdistricts_id?: number;

  @ApiPropertyOptional({
    description: 'รหัสไปรษณีย์ 5 หลัก (ส่งค่าว่างมาเพื่อล้างเป็น NULL ได้)',
    example: '30130',
  })
  @InputValue('text', { maxLength: 1000 })
  zip_code?: string;

  @ApiPropertyOptional({
    description: 'ชื่อหมู่บ้าน',
    example: 'หมู่บ้านจัดสรรอยู่สบาย',
  })
  @InputValue('text', { maxLength: 200 })
  village_name?: string;

  @ApiPropertyOptional({ description: 'หมู่ที่', example: 'หมู่ 4' })
  @InputValue('text', { maxLength: 45 })
  village_no?: string;

  @ApiPropertyOptional({
    description: 'ชื่อผู้ใหญ่บ้าน (ขึ้นบนใบเสร็จ)',
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
    description: 'เบอร์โทรติดต่อหมู่บ้าน (ขึ้นบนใบเสร็จ)',
    example: '0812345678',
  })
  @InputValue('text', { maxLength: 20 })
  phone?: string;

  @ApiPropertyOptional({
    description: 'รอบการออกบิล เช่น EVERY_MONTH หรือระบุเดือน',
    example: 'EVERY_MONTH',
  })
  @InputValue('text', { maxLength: 1000 })
  billing_month?: string;

  @ApiPropertyOptional({
    description:
      'ระยะเดินเฉลี่ยต่อ 1 มิเตอร์ เป็นเมตร — ชนบท/บ้านเดี่ยว 10-15, ทาวน์โฮม 4-8 ' +
      '(ส่ง null มาเพื่อกลับไปใช้ค่ากลาง 15 ได้) รับได้ 2-60',
    example: 12,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  meter_pitch_m?: number | null;
}
