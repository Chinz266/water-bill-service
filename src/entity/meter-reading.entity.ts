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