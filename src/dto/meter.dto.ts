import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** ลงทะเบียนมิเตอร์ตัวปัจจุบันของบ้าน (บ้านที่เข้าระบบก่อนมีทะเบียนมิเตอร์) */
export class RegisterMeterDto {
  @ApiProperty({ description: 'ID ของบ้าน', example: 1 })
  members_id!: number;

  @ApiPropertyOptional({
    description: 'เลขเครื่องบนตัวมิเตอร์',
    example: 'A1234567',
  })
  serial_no?: string;

  @ApiPropertyOptional({
    description:
      'จำนวนหลักบนหน้าปัด (นับเลขศูนย์นำหน้าด้วย: 00025 = 5 หลัก) — ' +
      'กรอกไว้แล้วด่านจับ OCR อ่านหลักหาย/เกิน จะทำงานตั้งแต่บิลใบแรกของบ้านนี้',
    example: 5,
  })
  digits?: number;

  @ApiPropertyOptional({
    description: 'วันที่ติดตั้ง (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
    example: '2026-08-14',
  })
  installed_at?: string;

  @ApiPropertyOptional({
    description: 'เลขบนหน้าปัดตอนติดตั้ง (มิเตอร์ใหม่ปกติ = 0)',
    example: 0,
  })
  initial_unit?: number;

  @ApiPropertyOptional({ description: 'บันทึกเพิ่มเติม' })
  note?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้บันทึก', example: 1 })
  create_by?: number;
}

/**
 * เปลี่ยนมิเตอร์ตัวใหม่ — ปิดทะเบียนตัวเก่าและเปิดตัวใหม่พร้อมกัน
 *
 * ⚠️ ต้องบันทึก **ตอนเปลี่ยน** ไม่ใช่รอไปกรอกตอนออกบิล เพราะคนที่เปลี่ยนมิเตอร์
 *    กับคนที่เดินจดรอบถัดไปมักไม่ใช่คนเดียวกัน — คนจดไม่มีทางรู้เลขปิดของตัวที่ถอดไปแล้ว
 *
 * หน่วยที่ใช้บนตัวเก่าก่อนถอด (final_unit − เลขตั้งต้นของบิลเดือนก่อน) จะถูกบวก
 * เข้าไปในบิลใบถัดไปให้อัตโนมัติ แล้วมาร์กว่าคิดแล้ว ไม่คิดซ้ำอีก
 */
export class ReplaceMeterDto {
  @ApiProperty({ description: 'ID ของบ้าน', example: 1 })
  members_id!: number;

  @ApiProperty({
    description:
      'เลขบนหน้าปัดของมิเตอร์ตัวเก่า ณ วันถอด — ตัวเลขนี้คือสิ่งเดียวที่ทำให้ ' +
      'น้ำที่ใช้ไปก่อนเปลี่ยนไม่หายไปจากระบบ',
    example: 1320,
  })
  old_final_unit!: number;

  @ApiPropertyOptional({
    description: 'เลขบนหน้าปัดของมิเตอร์ตัวใหม่ตอนติดตั้ง (ปกติ = 0)',
    example: 0,
  })
  new_initial_unit?: number;

  @ApiPropertyOptional({ description: 'เลขเครื่องของตัวใหม่' })
  new_serial_no?: string;

  @ApiPropertyOptional({
    description: 'จำนวนหลักบนหน้าปัดของตัวใหม่ (ต่างจากตัวเก่าได้)',
    example: 5,
  })
  new_digits?: number;

  @ApiPropertyOptional({
    description: 'วันที่เปลี่ยน (YYYY-MM-DD) — ไม่ส่งมาใช้วันนี้',
    example: '2026-08-14',
  })
  replaced_at?: string;

  @ApiPropertyOptional({
    description: 'เหตุผลที่เปลี่ยน เช่น หน้าปัดฝ้าอ่านไม่ออก / เข็มค้าง',
  })
  note?: string;

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้บันทึก', example: 1 })
  create_by?: number;
}
