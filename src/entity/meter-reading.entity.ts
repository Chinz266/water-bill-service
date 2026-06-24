import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('meter_readings')
export class MeterReadingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'date' })
  reading_date!: Date;

  @Column('int')
  meter_unit!: number; // หน่วยค่าน้ำที่จดได้ (หรือที่ OCR อ่านได้)

  @Column({ length: 100, nullable: true })
  evidence_photo!: string; // Path หรือ URL ของรูปถ่ายมิเตอร์น้ำ

  @Column()
  members_id!: number; // ID ของลูกบ้าน

  @Column({ nullable: true })
  create_by?: number;

  @CreateDateColumn()
  create_date!: Date;

  @Column({ nullable: true })
  modify_by!: number;

  @UpdateDateColumn()
  modify_date!: Date;
}