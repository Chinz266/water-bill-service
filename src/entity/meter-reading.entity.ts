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

  // 🌟 เวลาที่ไฟล์รูปถูกลบตามนโยบายเก็บ 1 ปี (PhotoRetentionService)
  //    ตั้งใจไม่ล้าง evidence_photo ทิ้ง เพราะ path ที่ยังอยู่คือหลักฐานว่า "เคยมีรูป"
  //    ต่างจาก NULL ที่แปลว่า "ไม่เคยถ่ายเลย" — สองอย่างนี้ต่างกันมากเวลาย้อนไปตรวจ
  //    หน้าเว็บต้องเช็คคอลัมน์นี้ก่อนขึ้นรูป ไม่งั้นจะได้ 404 จากไฟล์ที่ถูกลบไปแล้ว
  @Column({ type: 'datetime', nullable: true })
  photo_purged_at!: Date | null;

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

  // 🌟 ความมั่นใจของ "หลักที่อ่อนที่สุด" ที่ YOLO อ่านได้ (ไม่ใช่ค่าเฉลี่ย)
  //    main.py คืนค่าแบบนี้อยู่แล้ว เพราะเลขมิเตอร์ผิดหลักเดียวก็ผิดทั้งจำนวน
  //    ค่าเฉลี่ยจะกลบหลักที่ไม่ชัดจนมองไม่เห็น (สี่หลัก 0.99 + หนึ่งหลัก 0.41 = 0.87)
  //    เก็บไว้เป็นหลักฐานย้อนหลังด้วย ไม่ใช่แค่ตรวจแล้วทิ้ง
  //    NULL = กรอกเลขเอง ไม่ได้ผ่าน OCR (เหมือน meter_digits)
  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  read_confidence!: number | null;

  // 🌟 เลขนี้มาจากไหน — ของเดิมแยกไม่ออก ต้องเดาจาก meter_digits IS NULL
  //    ซึ่งไม่ตรงเสมอไป (OCR อ่านได้แต่ไม่ส่งจำนวนหลักมาก็เป็น NULL เหมือนกัน)
  //    ต้องแยกให้ชัดเพราะกฎ "กรอกมือต้องแนบรูปเสมอ" พึ่งค่านี้ตัวเดียว —
  //    กรอกมือคือจุดที่ไม่มีอะไรตรวจเลขได้เลยนอกจากรูปหน้าปัด
  @Column({
    type: 'enum',
    enum: ['ocr', 'manual', 'manual_after_ocr_fail'],
    default: 'ocr',
  })
  entry_method!: 'ocr' | 'manual' | 'manual_after_ocr_fail';

  // 🌟 รหัสที่มือถือสร้างตอนกดบันทึก (crypto.randomUUID) ใช้กันยิงซ้ำตอน auto-sync
  //    "ยิงแล้วเน็ตหลุดก่อนได้คำตอบ" แยกไม่ออกจาก "ยิงไม่สำเร็จ" แอปจึงต้องยิงซ้ำ
  //    ถ้าไม่มีอะไรกันจะได้บิลสองใบของเดือนเดียวกัน
  //    ⚠️ ต้องเป็น UNIQUE ระดับ DB ไม่ใช่ SELECT ก่อน INSERT ที่ชั้น service
  //       เพราะยิงซ้ำสองครั้งพร้อมกันจะ SELECT ไม่เจอทั้งคู่แล้ว INSERT ทั้งคู่
  @Column({ type: 'char', length: 36, nullable: true, unique: true })
  client_uuid!: string | null;

  // 🌟 ชื่อคอลัมน์จริงใน DB คือ members_id1 (มี 1 ต่อท้าย)
  @Column({ name: 'members_id1' })
  members_id!: number; // ID ของลูกบ้าน

  // 🌟 มิเตอร์ตัวที่อ่านค่านี้มา — NULL = การจดก่อนมีทะเบียนมิเตอร์ (ดู meters)
  //    ตั้งใจไม่เติมย้อนหลัง เพราะเดาไม่ได้ว่าแถวเก่าแถวไหนอ่านจากตัวไหน
  @Column({ type: 'int', nullable: true })
  meters_id!: number | null;

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
