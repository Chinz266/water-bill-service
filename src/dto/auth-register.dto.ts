import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MinLength,
  MaxLength,
  IsByteLength,
} from 'class-validator';

export class AuthRegisterDto {
  @ApiProperty({ description: 'ชื่อจริงของผู้ใช้', example: 'สมชาย' })
  @IsString()
  @Matches(/\S/, { message: 'กรุณากรอกชื่อ' })
  @MaxLength(45)
  fname!: string;

  @ApiProperty({ description: 'นามสกุลของผู้ใช้', example: 'ใจดี' })
  @IsString()
  @Matches(/\S/, { message: 'กรุณากรอกนามสกุล' })
  @MaxLength(45)
  lname!: string;

  @ApiProperty({
    description: 'อีเมล (ใช้เป็น Username)',
    example: 'somchai@example.com',
  })
  @IsEmail({}, { message: 'กรุณากรอกอีเมลให้ถูกต้อง' })
  @MaxLength(100)
  email!: string;

  @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
  @IsString()
  @MinLength(8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  @IsByteLength(0, 72, { message: 'รหัสผ่านยาวเกินไป (สูงสุด 72 ไบต์)' })
  password!: string;
}
