import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

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

  // สมมติสถานะการจ่ายเงินมี 3 แบบ: รอจ่าย, จ่ายแล้ว, ค้างชำระ
  // 🌟 ตัวพิมพ์ต้องตรงกับ enum ใน Database: ('Pending','Paid','Overdue')
  @Column({ type: 'enum', enum: ['Pending', 'Paid', 'Overdue'], default: 'Pending' })
  payment_status!: 'Pending' | 'Paid' | 'Overdue';

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