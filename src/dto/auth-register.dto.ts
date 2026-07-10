import { ApiProperty } from '@nestjs/swagger';

export class AuthRegisterDto {
    @ApiProperty({ description: 'ชื่อจริงของผู้ใช้', example: 'สมชาย' })
    fname!: string;

    @ApiProperty({ description: 'นามสกุลของผู้ใช้', example: 'ใจดี' })
    lname!: string;

    @ApiProperty({ description: 'อีเมล (ใช้เป็น Username)', example: 'somchai@example.com' })
    email!: string;

    @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
    password!: string;
}
