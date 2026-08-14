import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBillDto {
  @ApiProperty({ description: 'ID ของการจดมิเตอร์', example: 1 })
  meter_readings_id!: number;

  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  water_rates_id!: number;

  @ApiProperty({ description: 'หน่วยมิเตอร์เดือนที่แล้ว', example: 1200 })
  previous_unit!: number;

  @ApiProperty({ description: 'หน่วยมิเตอร์เดือนนี้', example: 1250 })
  current_unit!: number;

  //   @ApiProperty({ description: 'หน่วยน้ำที่ใช้ไป (เดือนนี้ - เดือนที่แล้ว)', example: 50 })
  //   usage_unit!: number;

  // @ApiProperty({ description: 'ยอดรวมที่ต้องชำระ (บาท)', example: 750.00 })
  // total_amount!: number;

  @ApiProperty({ description: 'บิลประจำเดือน (เช่น 01-12)', example: '06' })
  billing_month!: string;

  @ApiProperty({ description: 'บิลประจำปี (เช่น 2026)', example: '2026' })
  billing_year!: string;

  @ApiPropertyOptional({
    description: 'สถานะการจ่ายเงิน',
    enum: ['Pending', 'Paid', 'Overdue'],
    default: 'Pending',
    example: 'Pending',
  })
  payment_status?: 'Pending' | 'Paid' | 'Overdue';

  @ApiPropertyOptional({ description: 'ID ของ Admin ผู้สร้างบิล', example: 1 })
  create_by?: number;

  @ApiPropertyOptional({
    description:
      'ยืนยันจดทับบิลเดือนเดียวกันที่มีอยู่แล้ว (ลบใบเดิมทิ้งก่อนสร้างใหม่) — ' +
      'ไม่ส่งมา = ถ้าเจอบิลซ้ำเดือนจะตอบ 409 กลับไป',
    default: false,
  })
  replace?: boolean;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้องจริง — ไม่ส่งมาแล้วเข้าเกณฑ์ผิดปกติจะตอบ 409',
    default: false,
  })
  confirm_high_usage?: boolean;
}
