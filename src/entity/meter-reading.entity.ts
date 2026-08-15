import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('meter_readings')
export class MeterReadingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'date' })
  reading_date!: Date;

  @Column('int')
  meter_unit!: number; // หน่วยค่าน้ำที่จดได้ (หรือที่ OCR อ่านได้)

  @Column({ length: 1000, nullable: true })
  evidence_photo!: string; // Path หรือ URL ของรูปถ่ายมิเตอร์น้ำ

  // 🌟 พิกัดของ "จุดที่ยืนถ่ายรูป" ไม่ใช่พิกัดบ้านในทะเบียน
  //    เก็บทุกครั้งที่จด เพื่อให้ระบบเรียนรู้เองว่ามิเตอร์ของบ้านหลังนี้อยู่ตรงไหนจริง ๆ
  //    (ดู db/migrate-reading-location.sql ว่าทำไมใช้ members.latitude แทนไม่ได้)
  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude!: number | null;

  // precision 11 — ลองจิจูดไทย 97-106 มี 3 หลักหน้าจุด
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude!: number | null;

  /** ความคลาดเคลื่อนเป็นเมตร — Geolocation API มีให้ ส่วน EXIF ไม่มี (คงเป็น null) */
  @Column({ type: 'int', nullable: true })
  gps_accuracy_m!: number | null;

  /** เวลากดชัตเตอร์จริง — reading_date เป็น date ไม่มีเวลา จึงจับรูปใช้ซ้ำไม่ได้ */
  @Column({ type: 'datetime', nullable: true })
  captured_at!: Date | null;

  // 🌟 จำนวนหลักบนหน้าปัดที่ YOLO ตรวจเจอ — นับเลขศูนย์นำหน้าด้วย (00025 = 5 ไม่ใช่ 2)
  //    มิเตอร์ตัวเดิมมีจำนวนหลักคงที่เสมอ ค่าที่เปลี่ยนไปจึงแปลว่า OCR อ่านหลักหาย/เกิน
  //    ซึ่งเป็นความผิดพลาดที่ทำให้ยอดเงินคลาด 10 เท่าขึ้นไป (ดู db/migrate-meter-digits.sql)
  //    NULL = การจดครั้งนั้นกรอกมือ ไม่ได้ผ่าน OCR — ต้องข้ามตอนหาค่าอ้างอิง ไม่ใช่นับเป็น 0
  @Column({ type: 'tinyint', nullable: true })
  meter_digits!: number | null;

  // 🌟 ชื่อคอลัมน์จริงใน DB คือ members_id1 (มี 1 ต่อท้าย)
  @Column({ name: 'members_id1' })
  members_id!: number; // ID ของลูกบ้าน

  @Column({ nullable: true })
  create_by?: number;

  // 🌟 ชื่อคอลัมน์จริงใน DB สะกดว่า creat_date (ไม่มี e)
  // ⚠️ ห้ามใช้ @CreateDateColumn เพราะ TypeORM จะส่ง DEFAULT ลง INSERT โดยหวังว่า DB มี
  // DEFAULT CURRENT_TIMESTAMP แต่คอลัมน์จริงเป็น `date NOT NULL` ที่ไม่มี default
  // → MySQL จะเขียน '0000-00-00' ให้แทน จึงต้องให้ service เซ็ตค่าเอง (เหมือน water_rates)
  @Column({ name: 'creat_date', type: 'date' })
  create_date!: Date;

  @Column({ nullable: true })
  modify_by!: number;

  @Column({ type: 'date', nullable: true })
  modify_date!: Date | null;
}
