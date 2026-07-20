import { ApiProperty } from '@nestjs/swagger';

/** ใช้ทั้งสมัครและล็อกอินฝั่งลูกบ้าน — คนละ endpoint กับ admin ที่ใช้อีเมล */
export class MemberAuthDto {
  @ApiProperty({ description: 'เบอร์โทรที่ลงทะเบียนไว้กับบ้าน (ใช้เป็น username)', example: '0822222222' })
  phone!: string;

  @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
  password!: string;
}
