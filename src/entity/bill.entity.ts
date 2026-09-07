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

  /**
   * ค่าน้ำ **ของเดือนนี้เท่านั้น** = usage_unit × price_per_unit
   *
   * ⚠️ ห้ามเอายอดค้างเก่ามาบวกในนี้เด็ดขาด — usageBaseline(), outstandingByMember()
   *    และรายงานรายได้ทั้งหมดอ่านคอลัมน์นี้ว่าเป็นค่าน้ำของรอบเดียว
   *    เอายอดเก่ามาปนจะทำให้ยอดค้างถูกนับซ้ำทุกเดือนที่ทบต่อกันไป
   *    ยอดที่ต้องจ่ายจริงบนใบเสร็จอยู่ที่ grand_total
   */
  @Column('decimal', { precision: 10, scale: 2 })
  total_amount!: number;

  /** ยอดค้างจากบิลเก่าที่ทบเข้ามาในใบนี้ — ภาพนิ่ง ณ วันออกบิล ไม่คิดสดตอนแสดงผล */
  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  arrears_amount!: number;

  /**
   * ยอดที่ต้องจ่ายจริงบนใบนี้ = total_amount + arrears_amount
   *
   * เก็บเป็นภาพนิ่งเพราะใบที่พิมพ์ส่งให้ลูกบ้านไปแล้วต้องตรงกับที่ระบบบอกเสมอ
   * ต่อให้มีคนไปจ่ายบิลเก่าทีหลังก็ตาม — NULL = บิลเก่าก่อน migration
   */
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  grand_total!: number | null;

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

  /** ผู้อยู่อาศัยที่บิลใบนี้เรียกเก็บจาก — NULL = เจ้าของอยู่เอง หรือบิลก่อนมีตาราง tenancies */
  @Column({ type: 'int', nullable: true })
  tenancy_id!: number | null;

  /**
   * 1 = บิลปิดยอดตอนย้ายออก ไม่ใช่บิลประจำเดือน
   *
   * ต่างจากบิลปกติตรงที่ due_date เป็นวันย้ายออกเลย ไม่ยืดตาม payment_due_days
   * ของหมู่บ้าน (คนที่ย้ายออกไปแล้วตามเก็บทีหลังแทบไม่ได้)
   */
  @Column({ type: 'tinyint', default: 0 })
  is_final!: number;

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
