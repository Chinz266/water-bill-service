import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { AdminRole } from '../auth/auth.constants';

/**
 * ร่องรอยการแก้เลขมิเตอร์ของบิลที่ออกไปแล้ว (ดู db/migrate-reading-edit-log.sql)
 *
 * ═══ ทำไมต้องมีตารางนี้ ═══
 *
 * PATCH /bills/:id/reading เปลี่ยนยอดเงินที่ลูกบ้านต้องจ่ายของใบที่ออกไปแล้ว
 * ถ้าไม่เก็บ ค่าเดิมจะถูกทับหายไปทั้งหมด — ระบบตอบไม่ได้ว่าใบนี้เคยเป็นเท่าไหร่
 * ใครแก้ ตอนไหน ด้วยเหตุผลอะไร ซึ่งเป็นข้อมูลชิ้นเดียวที่แยก "แก้เพราะ OCR อ่านผิด"
 * ออกจาก "แก้ยอดให้ใครสักคน" ได้
 *
 * ต่างจาก ReadingFlagEntity ที่บันทึก "ระบบเตือนอะไรตอนออกบิล" — ตัวนี้บันทึก
 * "มีคนเข้าไปเปลี่ยนอะไรหลังออกบิลไปแล้ว" ซึ่งเป็นเหตุการณ์คนละชนิดกัน
 */
@Entity('meter_reading_logs')
export class MeterReadingLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  bills_id!: number;

  @Column({ type: 'int' })
  meter_readings_id!: number;

  /** บ้านเจ้าของบิล — เก็บซ้ำไว้เพื่อค้นย้อนหลังได้แม้การจดจะถูกลบไปแล้ว */
  @Column({ type: 'int', nullable: true })
  members_id!: number | null;

  @Column({ type: 'int' })
  old_unit!: number;

  @Column({ type: 'int' })
  new_unit!: number;

  @Column({ type: 'int' })
  old_usage_unit!: number;

  @Column({ type: 'int' })
  new_usage_unit!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  old_total_amount!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  new_total_amount!: number;

  /** เหตุผลที่แก้ — บังคับกรอกเสมอ การแก้ที่ไม่มีเหตุผลกำกับเท่ากับไม่มีร่องรอย */
  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @Column({ type: 'tinyint', default: 0 })
  photo_replaced!: number;

  /** ด่านที่ถูกกดยืนยันข้ามในการแก้ครั้งนี้ เช่น 'high_usage,meter_reset' */
  @Column({ type: 'varchar', length: 200, nullable: true })
  confirmed_flags!: string | null;

  @Column({ type: 'int', nullable: true })
  changed_by!: number | null;

  /** สิทธิ์ของคนที่แก้ ณ ตอนนั้น — เก็บไว้เพราะสิทธิ์ของบัญชีเปลี่ยนทีหลังได้ */
  @Column({ type: 'enum', enum: ['owner', 'staff'], nullable: true })
  changed_role!: AdminRole | null;

  // ✅ ใช้ @CreateDateColumn ได้ เพราะตารางนี้เราสร้างเองและใส่ DEFAULT CURRENT_TIMESTAMP ไว้แล้ว
  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
