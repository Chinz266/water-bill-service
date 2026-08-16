import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * สถานะการชำระเงิน — ตัวพิมพ์ต้องตรงกับ enum ใน Database ('Pending','Paid','Overdue')
 * ประกาศไว้ที่เดียวเหมือน REPORT_STATUSES เพื่อให้ service เอาไปตรวจค่าที่ผู้ใช้ส่งมาได้
 */
export const PAYMENT_STATUSES = ['Pending', 'Paid', 'Overdue'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

@Entity('bills')
export class BillEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  meter_readings_id!: number; // โยงไปหาประวัติการจดมิเตอร์

  @Column()
  water_rates_id!: number; // โยงไปหาเรทค่าน้ำตอนที่คำนวณบิลนี้

  @Column('int')
  previous_unit!: number; // หน่วยเดือนที่แล้ว

  @Column('int')
  current_unit!: number; // หน่วยเดือนนี้

  @Column('int')
  usage_unit!: number; // หน่วยที่ใช้ไป (current - previous)

  @Column('decimal', { precision: 10, scale: 2 })
  total_amount!: number; // ยอดรวมที่ต้องชำระ

  @Column({ length: 10 })
  billing_month!: string; // ประจำเดือน (เช่น '06')

  @Column({ length: 10 })
  billing_year!: string; // ประจำปี (เช่น '2026')

  /**
   * วันครบกำหนดชำระ — `markOverdue()` ใช้ตัวนี้ดีดสถานะเป็น Overdue เอง
   * NULL = บิลเก่าที่ออกก่อนมีระบบนี้ ตั้งใจไม่เติมย้อนหลัง (ดู db/migrate-bill-audit.sql)
   */
  @Column({ type: 'date', nullable: true })
  due_date!: Date | null;

  /**
   * บิลใบนี้ครอบคลุมกี่เดือน — >1 แปลว่ามีเดือนที่ไม่ได้จดคั่นอยู่
   * ด่านหน่วยพุ่งต้องหารด้วยค่านี้ก่อนเทียบเกณฑ์ ไม่งั้นบิล 2 เดือนจะเด้งทั้งที่เลขถูก
   */
  @Column({ type: 'tinyint', unsigned: true, default: 1 })
  period_months!: number;

  // สมมติสถานะการจ่ายเงินมี 3 แบบ: รอจ่าย, จ่ายแล้ว, ค้างชำระ
  @Column({
    type: 'enum',
    enum: [...PAYMENT_STATUSES],
    default: 'Pending',
  })
  payment_status!: PaymentStatus;

  @Column({ length: 1000, nullable: true })
  pdf_path!: string; // Path สำหรับเก็บไฟล์ PDF บิลค่าน้ำ

  @Column({ nullable: true })
  create_by?: number;

  @CreateDateColumn()
  create_date!: Date;

  @Column({ nullable: true })
  modify_by!: number;

  @UpdateDateColumn()
  modify_date!: Date;
}
