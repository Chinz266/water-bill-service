import { ApiProperty } from '@nestjs/swagger';

export class MemberCreateDto {
    @ApiProperty({ description: 'ID of the member', example: 1 })
    id!: number;

    @ApiProperty({ description: 'First name of the member', example: 'Somchai' })
    fname!: string;

    @ApiProperty({ description: 'Last name of the member', example: 'Jaidee' })
    lname!: string;

    @ApiProperty({ description: 'Phone number of the member', example: '0812345678' })
    phone!: string;

    @ApiProperty({ description: 'Address of the member', example: '123/45 Bangkok' })
    address!: string;

    @ApiProperty({ description: 'Status of the member', example: 'active' })
    status!: string;
}
