import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('villages') // กำหนดชื่อตารางให้ตรงกับใน Database
export class VillageEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  provinces_id!: number;

  @Column()
  districts_id!: number;

  @Column()
  subdistricts_id!: number;

  // เก็บแยกจาก subdistricts.zip_code เพราะตารางนั้นเป็นข้อมูลอ้างอิงที่ใช้ร่วมกัน
  // ทั้งระบบ และรหัสของบางตำบลก็ว่าง/ไม่ตรง — ดู db/migrate-village-zipcode.sql
  @Column({ length: 5, nullable: true })
  zip_code!: string;

  @Column({ length: 200 })
  village_name!: string;

  @Column({ length: 45 })
  village_no!: string;

  @Column({ length: 45, nullable: true })
  headman_name!: string;

  @Column({ length: 45, nullable: true })
  deputy_headman_name!: string;

  @Column({ length: 45, nullable: true })
  phone!: string;

  @Column({ length: 45, default: 'EVERY_MONTH' })
  billing_month!: string;

  // ระยะเดินเฉลี่ยต่อ 1 มิเตอร์ (เมตร) — ScanBatchService ใช้คำนวณรัศมีที่ถือว่า
  // "ไกลจนน่าสงสัย" หมู่บ้านหนาแน่นต่างกันมาก รัศมีคงที่ทั้งระบบจึงหลวมเกินไป
  // สำหรับทาวน์โฮม NULL = ใช้ค่ากลาง ดู db/migrate-village-meter-pitch.sql
  @Column({ type: 'smallint', unsigned: true, nullable: true })
  meter_pitch_m!: number | null;

  // ให้เวลาชำระกี่วันนับจากวันจดมิเตอร์ — แต่ละหมู่บ้านเก็บเงินคนละรอบ
  // (บางที่เก็บวันประชุมประจำเดือน บางที่ให้ไปจ่ายเมื่อไหร่ก็ได้)
  // NULL = ใช้ค่ากลาง BillsService.DEFAULT_PAYMENT_DUE_DAYS
  @Column({ type: 'smallint', unsigned: true, nullable: true })
  payment_due_days!: number | null;

  @Column()
  create_by!: number;

  // 🌟 ชื่อคอลัมน์จริงใน DB สะกดว่า craeta_date
  @CreateDateColumn({ name: 'craeta_date' })
  create_date!: Date;

  @Column({ nullable: true })
  modify_by!: number;

  @UpdateDateColumn()
  modify_date!: Date;
}
