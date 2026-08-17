import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * บิลใบใหม่ทบยอดค้างของใบเก่าใบไหนมาบ้าง (1 แถว = 1 คู่)
 *
 * ต้องรู้รายใบ ไม่ใช่แค่ยอดรวมใน bills.arrears_amount เพราะตอนรับเงินต้องปิด
 * ใบเก่าทุกใบที่ถูกทบให้เป็น Paid ในทรานแซกชันเดียวกัน — ถ้าไม่ปิด ยอดเดิม
 * จะถูกทบเข้าบิลเดือนถัดไปอีกรอบ กลายเป็นเก็บเงินซ้ำจากก้อนที่จ่ายไปแล้ว
 */
@Entity('bill_arrears')
export class BillArrearsEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** บิลใบใหม่ที่ทบยอดเข้ามา */
  @Column({ type: 'int' })
  bill_id!: number;

  /** บิลใบเก่าที่ถูกทบ */
  @Column({ type: 'int' })
  covered_bill_id!: number;

  /** ยอดของใบเก่า ณ ตอนที่ทบ — เก็บไว้เพราะ total_amount ของใบเก่าแก้ได้ทีหลัง */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
