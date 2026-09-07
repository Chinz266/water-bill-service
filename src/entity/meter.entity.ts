import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * มิเตอร์แต่ละตัวที่เคยติดตั้งให้บ้านหลังหนึ่ง (1 บ้าน = หลายตัวตามอายุการใช้งาน)
 *
 * ของเดิมรับ `old_meter_final_unit` มาเป็นค่าครั้งเดียวตอนออกบิลแล้วทิ้ง ระบบจึง
 * ตอบไม่ได้ว่ามิเตอร์ตัวไหนถูกถอดเมื่อไหร่ ปิดที่เลขเท่าไหร่ — เวลาลูกบ้านทักท้วง
 * ว่า "เดือนที่เปลี่ยนมิเตอร์คิดเงินเกิน" ไม่มีอะไรให้ไล่ดูเลย
 *
 * `digits` ยังทำให้ด่านจำนวนหลักครอบตั้งแต่บิลใบแรกของบ้านนั้น จากเดิมที่ต้องรอ
 * ให้จดผ่าน OCR ครบสองครั้งก่อน (ดู docs/known-issues.md)
 */
@Entity('meters')
export class MeterEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'members_id', type: 'int' })
  members_id!: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  serial_no!: string | null;

  /** จำนวนหลักบนหน้าปัด — นับเลขศูนย์นำหน้าด้วย (00025 = 5 หลัก ไม่ใช่ 2) */
  @Column({ type: 'tinyint', unsigned: true, nullable: true })
  digits!: number | null;

  @Column({ type: 'date' })
  installed_at!: Date;

  /** NULL = ตัวที่ใช้อยู่ปัจจุบัน */
  @Column({ type: 'date', nullable: true })
  removed_at!: Date | null;

  @Column({ type: 'int', default: 0 })
  initial_unit!: number;

  /** เลขปิด ณ วันถอด — ใช้คิดน้ำที่ใช้ไปก่อนถอดออก */
  @Column({ type: 'int', nullable: true })
  final_unit!: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  /**
   * หน่วยที่ใช้บนตัวนี้ก่อนถอด ถูกคิดเข้าบิลไปแล้วเมื่อไหร่ — NULL = ยังรอคิด
   *
   * ขาดคอลัมน์นี้ไม่ได้ ไม่งั้นระบบแยกไม่ออกว่า final_unit ถูกคิดไปแล้วหรือยัง
   * แล้วจะบวกหน่วยก้อนเดิมเข้าไปในบิลทุกใบหลังจากนั้น — เก็บซ้ำทุกเดือน
   */
  @Column({ type: 'datetime', nullable: true })
  residual_billed_at!: Date | null;

  @Column({ type: 'int', nullable: true })
  residual_bill_id!: number | null;

  @Column({ type: 'int', nullable: true })
  create_by!: number | null;

  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
