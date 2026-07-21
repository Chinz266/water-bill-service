import { ApiProperty } from '@nestjs/swagger';

export class AdminCreateDto {
  @ApiProperty({ description: 'ID of the admin', example: 1 })
  id!: number;

  @ApiProperty({ description: 'First name of the admin', example: 'John' })
  fname!: string;

  @ApiProperty({ description: 'Last name of the admin', example: 'Doe' })
  lname!: string;

  @ApiProperty({
    description: 'Phone number of the admin',
    example: '0812345678',
  })
  phone!: string;

  @ApiProperty({ description: 'Password of the admin', example: 'password123' })
  password!: string;

  @ApiProperty({ description: 'Role of the admin', example: 'admin' })
  role!: string;
}
