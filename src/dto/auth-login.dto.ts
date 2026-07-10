import { ApiProperty } from '@nestjs/swagger';

export class AuthLoginDto {
    @ApiProperty({ description: 'อีเมล (ใช้เป็น Username)', example: 'somchai@example.com' })
    email!: string;

    @ApiProperty({ description: 'รหัสผ่าน', example: 'password123' })
    password!: string;
}
