import { ApiProperty } from '@nestjs/swagger';

export class MemberRemoveDto {
    @ApiProperty({ description: 'ID of the member', example: 1 })
    id!: number;
}
