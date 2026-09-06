import { InputValue } from '../security/input-value';
import { ApiProperty } from '@nestjs/swagger';

export class AdminRemoveDto {
  @ApiProperty({ description: 'ID of the admin to remove', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  id!: number;
}
