import { ApiProperty } from '@nestjs/swagger';

export class AdminRemoveDto {
  @ApiProperty({ description: 'ID of the admin to remove', example: 1 })
  id!: number;
}
