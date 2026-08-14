import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** ลูกบ้านเข้าระบบด้วยเบอร์โทรอย่างเดียว — คนละ endpoint กับ admin ที่ใช้อีเมล+รหัสผ่าน */
export class MemberAuthDto {
  @ApiProperty({
    description: 'เบอร์โทรที่ลงทะเบียนไว้กับบ้าน (ใช้เป็น username)',
    example: '0822222222',
  })
  phone!: string;

  // เผื่อ client เก่าที่ยังส่งรหัสผ่านมา — ระบบไม่ใช้แล้ว รับไว้เฉย ๆ จะได้ไม่ error
  @ApiPropertyOptional({
    description: 'ไม่ใช้แล้ว (ระบบเข้าด้วยเบอร์โทรอย่างเดียว)',
  })
  password?: string;
}
