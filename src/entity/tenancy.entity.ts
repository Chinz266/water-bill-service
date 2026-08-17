import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * ช่วงเวลาที่แต่ละคนอยู่บ้านหลังนี้ — ใช้กับบ้านเช่าที่เปลี่ยนผู้เช่ากลางเดือน
 *
 * ไม่ได้มาแทน members.fname/lname ทั้งระบบยังอ่านชื่อจากที่นั่นเหมือนเดิมในฐานะ
 * "ผู้อยู่ปัจจุบัน" ตารางนี้เป็นชั้นประวัติที่วางทับ เพื่อให้ย้อนดูได้ว่าบิลเดือนไหน
 * เรียกเก็บจากใคร ตอนที่คนนั้นย้ายออกไปแล้ว
 */
@Entity('tenancies')
export class TenancyEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'members_id', type: 'int' })
  members_id!: number;

  @Column({ type: 'varchar', length: 90 })
  occupant_name!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string | null;

  @Column({ type: 'date' })
  start_date!: Date;

  /** NULL = ยังอยู่ปัจจุบัน */
  @Column({ type: 'date', nullable: true })
  end_date!: Date | null;

  @Column({ type: 'int', nullable: true })
  create_by!: number | null;

  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
