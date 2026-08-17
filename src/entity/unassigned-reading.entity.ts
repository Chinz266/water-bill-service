import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

export const UNASSIGNED_STATUSES = [
  'Pending',
  'Assigned',
  'Discarded',
] as const;
export type UnassignedStatus = (typeof UNASSIGNED_STATUSES)[number];

/**
 * รูปมิเตอร์ที่ยังไม่รู้ว่าเป็นของบ้านหลังไหน — รอ Admin จับคู่ทีหลัง
 *
 * เกิดจากสองเคสที่หน้างานแก้เองไม่ได้:
 *   1. OCR อ่านเลขไม่ออก (หน้าปัดฝ้า/โคลนบัง) ไม่มีเลขไปเทียบกับบ้านใดเลย
 *   2. อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน (ambiguous) คนหน้างานยืนยันไม่ได้
 *
 * ═══ ทำไมเป็นตารางแยก ไม่ใช่ meter_readings ที่ members_id เป็น NULL ═══
 *
 * คอลัมน์นั้นเป็น NOT NULL + FK และคิวรีทั้งระบบ (เลขตั้งต้น, บิล, พิกัดที่เรียนรู้)
 * ตั้งอยู่บนสมมติฐานว่าการจดทุกแถวมีบ้านเจ้าของเสมอ การเปิดให้เป็น NULL เท่ากับ
 * ต้องไล่แก้เงื่อนไขทุกจุดพร้อมกัน และจุดที่ลืมจะเงียบ ไม่ error
 *
 * แถวนี้ไม่มีผลต่อยอดเงินใด ๆ จนกว่าจะถูกจับคู่ — ตอนจับคู่จะวิ่งผ่าน
 * POST /bills/scan ตัวเดิม ด่านกันข้อมูลผิดทั้งหมดจึงยังทำงานครบ
 */
@Entity('unassigned_readings')
export class UnassignedReadingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  /** หมู่บ้านที่กำลังเดินจดตอนถ่าย — ช่วยจำกัดรายชื่อบ้านตอนหาผู้สมัคร */
  @Column({ type: 'int', nullable: true })
  villages_id!: number | null;

  /** NULL = OCR อ่านไม่ออก ให้ Admin เปิดรูปแล้วพิมพ์เอง */
  @Column({ type: 'int', nullable: true })
  meter_unit!: number | null;

  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  meter_digits!: number | null;

  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  read_confidence!: number | null;

  /** NOT NULL ต่างจาก meter_readings — ไม่มีรูปก็ไม่เหลืออะไรให้คนตัดสิน */
  @Column({ type: 'varchar', length: 1000 })
  evidence_photo!: string;

  @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
  latitude!: number | null;

  // precision 11 — ลองจิจูดไทย 97-106 มี 3 หลักหน้าจุด (เหมือน meter_readings)
  @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
  longitude!: number | null;

  @Column({ type: 'int', nullable: true })
  gps_accuracy_m!: number | null;

  @Column({ type: 'datetime', nullable: true })
  captured_at!: Date | null;

  @Column({
    type: 'enum',
    enum: [...UNASSIGNED_STATUSES],
    default: 'Pending',
  })
  status!: UnassignedStatus;

  /** การจดที่เกิดขึ้นจริงหลังจับคู่สำเร็จ */
  @Column({ type: 'int', nullable: true })
  resolved_reading_id!: number | null;

  @Column({ type: 'int', nullable: true })
  resolved_by!: number | null;

  @Column({ type: 'datetime', nullable: true })
  resolved_date!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ type: 'int', nullable: true })
  create_by!: number | null;

  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
