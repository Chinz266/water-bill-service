import { InputValue } from '../security/input-value';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsOptional } from 'class-validator';

/**
 * ตรวจแค่ "ส่งมาหรือเปล่า" ไม่ตรวจชนิด — หน้าเว็บส่งตัวเลขมาเป็น string ในบางเส้นทาง
 * การรัดชนิดตรงนี้จะทำให้ของที่เคยใช้ได้พังทันที ส่วนที่เป็นบั๊กจริงคือฟิลด์ที่หายไป
 * แล้วไปโผล่เป็น 500 ที่ชั้น service (ดู ValidationPipe ใน main.ts)
 */
export class CreateBillDto {
  @IsDefined({ message: 'ต้องระบุ meter_readings_id (ID ของการจดมิเตอร์)' })
  @ApiProperty({ description: 'ID ของการจดมิเตอร์', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  meter_readings_id!: number;

  @IsDefined({ message: 'ต้องระบุ water_rates_id (ID ของเรทค่าน้ำ)' })
  @ApiProperty({ description: 'ID ของเรทค่าน้ำที่ใช้คำนวณ', example: 1 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  water_rates_id!: number;

  @ApiProperty({ description: 'หน่วยมิเตอร์เดือนที่แล้ว', example: 1200 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  previous_unit!: number;

  @ApiProperty({ description: 'หน่วยมิเตอร์เดือนนี้', example: 1250 })
  @InputValue('integer', { min: 0, max: 2147483647 })
  current_unit!: number;

  //   @ApiProperty({ description: 'หน่วยน้ำที่ใช้ไป (เดือนนี้ - เดือนที่แล้ว)', example: 50 })
  //   usage_unit!: number;

  // @ApiProperty({ description: 'ยอดรวมที่ต้องชำระ (บาท)', example: 750.00 })
  // total_amount!: number;

  @IsDefined({ message: 'ต้องระบุ billing_month (บิลประจำเดือน)' })
  @ApiProperty({ description: 'บิลประจำเดือน (เช่น 01-12)', example: '06' })
  @InputValue('text', { maxLength: 1000 })
  billing_month!: string;

  @IsDefined({ message: 'ต้องระบุ billing_year (บิลประจำปี)' })
  @ApiProperty({ description: 'บิลประจำปี (เช่น 2026)', example: '2026' })
  @InputValue('text', { maxLength: 1000 })
  billing_year!: string;

  @ApiPropertyOptional({
    description: 'สถานะการจ่ายเงิน',
    enum: ['Pending', 'Paid', 'Overdue'],
    default: 'Pending',
    example: 'Pending',
  })
  @InputValue('text', { maxLength: 1000 })
  payment_status?: 'Pending' | 'Paid' | 'Overdue';

  /**
   * @deprecated ไม่ถูกใช้แล้ว — เซิร์ฟเวอร์อ่านจาก token ของคนที่ล็อกอินอยู่แทน
   * (ค่าที่ส่งมาถูกทับทิ้งเสมอ ดู BillsController.create) ยังรับไว้กัน client เก่าพัง
   */
  @IsOptional()
  @ApiPropertyOptional({
    description: 'ไม่ใช้แล้ว — อ่านจาก token แทน',
    example: 1,
  })
  @InputValue('integer', { min: 0, max: 2147483647 })
  create_by?: number;

  @ApiPropertyOptional({
    description:
      'ยืนยันจดทับบิลเดือนเดียวกันที่มีอยู่แล้ว (ลบใบเดิมทิ้งก่อนสร้างใหม่) — ' +
      'ไม่ส่งมา = ถ้าเจอบิลซ้ำเดือนจะตอบ 409 กลับไป',
    default: false,
  })
  @InputValue('boolean', {})
  replace?: boolean;

  @ApiPropertyOptional({
    description:
      'ยืนยันว่าหน่วยน้ำที่สูงผิดปกตินั้นถูกต้องจริง — ไม่ส่งมาแล้วเข้าเกณฑ์ผิดปกติจะตอบ 409',
    default: false,
  })
  @InputValue('boolean', {})
  confirm_high_usage?: boolean;
}
