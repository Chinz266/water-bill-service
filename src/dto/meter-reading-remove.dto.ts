import { ApiProperty } from '@nestjs/swagger';

export class MeterReadingRemoveDto {
    @ApiProperty({ description: 'ID of the meter reading', example: 1 })
    id!: number;
}
