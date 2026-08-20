import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * ร่องรอยการลบบิล (ดู db/migrate-match-provenance.sql)
 *
 * ═══ ทำไมต้องมีตารางนี้ ═══
 *
 * บ้านของบิลที่ออกไปแล้ว **แก้ไม่ได้** — UpdateReadingDto ไม่มี members_id
 * ทางแก้ "ออกบิลผิดบ้าน" จึงมีทางเดียวคือลบใบนั้นทิ้งแล้วออกใหม่ให้บ้านที่ถูก
 *
 * และ BillsService.remove() ลบทั้งบิลและ meter_readings ในทรานแซกชันเดียว
 * แถวที่ถือ matched_by / match_confidence จึงหายไปพร้อมกัน — พอดีกับจังหวะที่
 * มันมีค่าที่สุด เท่ากับหลักฐานของ "ระบบเลือกบ้านเองแล้วผิด" ถูกลบทิ้งทุกครั้ง
 * ที่มีคนไปแก้ให้ถูก ซึ่งเป็นเหตุผลว่าทำไมอัตราความผิดพลาดของการออกบิลอัตโนมัติ
 * ถึงไม่เคยวัดได้เลย
 *
 * ต่างจาก MeterReadingLogEntity ที่บันทึก "มีคนแก้เลขของใบที่ยังอยู่" — ตัวนี้บันทึก
 * "ใบทั้งใบหายไป" ซึ่งเป็นทางที่การแก้บ้านผิดหลังเดินผ่านเสมอ
 *
 * ⚠️ ตารางนี้เขียนอย่างเดียว ไม่มีทางแก้หรือลบแถว และไม่ผูก FK ไปที่ไหนเลย
 *    ของที่มันพูดถึงถูกลบไปแล้วทั้งหมดตั้งแต่ตอนที่แถวนี้ถูกเขียน
 */
@Entity('bill_deletion_logs')
export class BillDeletionLogEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  bills_id!: number;

  @Column({ type: 'int', nullable: true })
  meter_readings_id!: number | null;

  @Column({ type: 'int', nullable: true })
  members_id!: number | null;

  /** เก็บซ้ำเป็นข้อความ เพราะบ้านถูกลบทีหลังได้ แล้ว log ที่เหลือแต่ id จะอ่านไม่ออก */
  @Column({ type: 'varchar', length: 50, nullable: true })
  house_no!: string | null;

  @Column({ type: 'char', length: 2, nullable: true })
  billing_month!: string | null;

  @Column({ type: 'char', length: 4, nullable: true })
  billing_year!: string | null;

  @Column({ type: 'int', nullable: true })
  meter_unit!: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  total_amount!: number | null;

  /**
   * สำเนาจาก meter_readings ก่อนลบ — คอลัมน์ที่ตอบว่าใบนี้ "ระบบเลือกบ้านเอง" หรือเปล่า
   * นับคู่กับการจดที่ยังอยู่ จะได้อัตราการลบแยกตามที่มาของการจับคู่
   */
  @Column({
    type: 'enum',
    enum: ['system', 'manual', 'none'],
    nullable: true,
  })
  matched_by!: 'system' | 'manual' | 'none' | null;

  @Column({
    type: 'enum',
    enum: ['high', 'medium', 'ambiguous', 'none'],
    nullable: true,
  })
  match_confidence!: 'high' | 'medium' | 'ambiguous' | 'none' | null;

  @Column({
    type: 'enum',
    enum: ['ocr', 'manual', 'manual_after_ocr_fail'],
    nullable: true,
  })
  entry_method!: 'ocr' | 'manual' | 'manual_after_ocr_fail' | null;

  /** 'replace' = ถูกจดทับด้วยใบใหม่ของบ้านเดียวกัน ไม่ใช่การลบเพราะเลือกบ้านผิด */
  @Column({ type: 'varchar', length: 500, nullable: true })
  reason!: string | null;

  @Column({ type: 'int', nullable: true })
  deleted_by!: number | null;

  @CreateDateColumn({ type: 'datetime' })
  create_date!: Date;
}
