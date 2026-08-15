import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ลงทะเบียนลูกบ้านแบบ "ไปยืนที่มิเตอร์" — ใช้แทน POST /member/create แบบเดิม
 *
 * ═══ ต่างจากของเดิมยังไง ═══
 *
 * ของเดิมกรอกฟอร์มจากที่ทำการ พิกัดได้มาจากการจิ้มหมุดบนแผนที่ (ถ้ากรอก)
 * และ **ไม่เคยบันทึกเลขมิเตอร์ตั้งต้น** ทำให้เกิดปัญหาสองอย่าง:
 *
 *   1. พิกัดในทะเบียนคือกลางหลังคา แต่ตอนจดมิเตอร์พนักงานยืนริมรั้ว
 *      เหลื่อมกัน 10-15 ม. ทุกครั้ง — พอ ๆ กับระยะห่างระหว่างบ้าน จึงแยกบ้านไม่ออก
 *   2. ไม่มีเลขตั้งต้น → บิลใบแรกคิดจาก 0 บ้านที่มิเตอร์เดินมาแล้ว 800 หน่วย
 *      ก่อนเข้าระบบจะโดนเก็บย้อนหลังทั้งก้อนโดยไม่มีใครเตือน
 *
 * แบบใหม่แก้ทั้งสองข้อพร้อมกัน เพราะบันทึกตอนยืนอยู่หน้ามิเตอร์จริง:
 *   - พิกัดมาจากเซนเซอร์เดียวกัน ยืนที่เดียวกับตอนจดทุกเดือน → เทียบกันได้จริง
 *   - ถ่ายรูปหน้าปัดไปด้วย ได้เลขตั้งต้นพร้อมหลักฐาน
 */
export class RegisterMemberOnsiteDto {
  @ApiProperty({ description: 'ชื่อจริง', example: 'สมชาย' })
  fname!: string;

  @ApiProperty({ description: 'นามสกุล', example: 'ใจดี' })
  lname!: string;

  @ApiProperty({ description: 'บ้านเลขที่', example: '99/9' })
  house_no!: string;

  @ApiPropertyOptional({ description: 'เบอร์โทรศัพท์', example: '0812345678' })
  phone?: string;

  @ApiProperty({ description: 'ID ของหมู่บ้าน', example: 1 })
  villages_id!: number;

  @ApiProperty({ description: 'ID ของ Admin ผู้บันทึก', example: 1 })
  create_by!: number;

  @ApiProperty({
    description:
      'ละติจูดที่วัดได้ ณ จุดที่ยืนอยู่หน้ามิเตอร์ — ต้องมาจาก navigator.geolocation ' +
      'ตอนยืนอยู่จริง ห้ามจิ้มจากแผนที่ ไม่งั้นจะเทียบกับตอนจดมิเตอร์ไม่ได้',
    example: 14.9799,
  })
  latitude!: number;

  @ApiProperty({
    description: 'ลองจิจูดที่วัดได้ ณ จุดเดียวกัน',
    example: 102.097771,
  })
  longitude!: number;

  @ApiPropertyOptional({
    description:
      'ความคลาดเคลื่อนของพิกัดเป็นเมตร (coords.accuracy) — เกิน 50 ม. ระบบจะปฏิเสธ ' +
      'เพราะพิกัดที่ห่วยกว่านั้นใช้แยกบ้านไม่ได้อยู่แล้ว ให้รอสัญญาณนิ่งก่อนแล้วกดใหม่',
    example: 12,
  })
  gps_accuracy_m?: number;

  @ApiProperty({
    description:
      'เลขมิเตอร์ ณ วันลงทะเบียน — ตัวเลขนี้จะกลายเป็นเลขตั้งต้นของบิลใบแรก ' +
      'ถ้าไม่บันทึกไว้ บ้านหลังนี้จะโดนคิดค่าน้ำย้อนหลังตั้งแต่วันติดตั้งมิเตอร์',
    example: 1250,
  })
  initial_meter_unit!: number;

  @ApiPropertyOptional({
    description:
      'รูปหน้าปัดมิเตอร์ตอนลงทะเบียน (data URL) เก็บเป็นหลักฐานของเลขตั้งต้น',
  })
  meter_photo?: string;
}
