import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class AuthLoginDto {
  @ApiProperty({
    description: 'อีเมล (ใช้เป็น Username)',
    example: 'somchai@example.com',
  })
  @IsEmail({}, { message: 'กรุณากรอกอีเมลให้ถูกต้อง' })
  @MaxLength(100)
  email!: string;

  @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสผ่าน' })
  @MaxLength(1024)
  password!: string;
}
