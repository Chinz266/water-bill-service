import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * ชนิดของธง — ตัวพิมพ์ต้องตรงกับ enum ใน Database (ดู db/migrate-reading-audit.sql)
 *
 * ประกาศไว้ที่เดียวเหมือน PAYMENT_STATUSES เพื่อให้ service เอาไปตรวจค่าได้
 */
export const READING_FLAG_TYPES = [
  'duplicate_location',
  'burst_photo',
  'future_timestamp',
  'stale_photo',
  'meter_reset',
  'high_usage',
  'usage_warning',
  'digit_change',
  'low_confidence',
  'manual_entry',
  'offline_sync',
] as const;

export type ReadingFlagType = (typeof READING_FLAG_TYPES)[number];

/**
 * ร่องรอยว่าการจดครั้งนี้ติดธงอะไรไว้บ้าง และใครเป็นคนกดผ่าน
 *
 * ก่อนมีตารางนี้ ปุ่ม confirm_* ทุกตัวกดข้ามด่านได้แบบไม่เหลือหลักฐาน ระบบจึง
 * ตอบไม่ได้ว่าเดือนที่แล้วมีการกดข้ามด่านไหนกี่ครั้ง — ซึ่งเป็นข้อมูลชิ้นเดียว
 * ที่แยก "เจอเคสแปลกจริง" ออกจาก "กดผ่านทุกใบจนด่านไร้ความหมาย" ได้
 *
 * 1 การจด ติดได้หลายธง จึงต้องเป็นตารางแยก ไม่ใช่คอลัมน์ใน meter_readings
 */
@Entity('reading_flags')
export class ReadingFlagEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'meter_readings_id', type: 'int' })
  meter_readings_id!: number;

  @Column({ type: 'enum', enum: [...READING_FLAG_TYPES] })
  flag_type!: ReadingFlagType;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detail!: string | null;

  /** admin.id ของคนที่กดยืนยันข้ามด่าน — NULL = ระบบติดธงเอง ไม่มีใครกด */
  @Column({ type: 'int', nullable: true })
  confirmed_by!: number | null;

  // ✅ ใช้ @CreateDateColumn ได้ เพราะตารางนี้เราสร้างเองและใส่ DEFAULT CURRENT_TIMESTAMP ไว้แล้ว
  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
