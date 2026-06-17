import { ApiProperty } from '@nestjs/swagger';

export class MeterReadingCreateDto {
    @ApiProperty({ description: 'ID of the meter reading', example: 1 })
    id!: number;

    @ApiProperty({ description: 'Date of the meter reading', example: '2023-10-01' })
    readingDate!: Date;

    @ApiProperty({ description: 'The unit value read from the meter', example: 125 })
    meterUnit!: number;

    @ApiProperty({ description: 'Path or URL to the evidence photo', example: '/images/meter1.jpg' })
    evidencePhoto!: string;

    @ApiProperty({ description: 'ID of the member associated with this reading', example: 1 })
    membersId!: number;
}
