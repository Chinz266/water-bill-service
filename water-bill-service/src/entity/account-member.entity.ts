import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * ตารางเชื่อมบัญชี ↔ บ้าน (many-to-many)
 *
 * ทำไมต้องแยกตาราง แทนที่จะฝัง members_id คอลัมน์เดียวใน admin:
 * ข้อมูลจริงมีเบอร์เดียวผูกกับหลายบ้าน (คนดูแลหลายหลัง/ญาติใช้เบอร์ร่วมกัน)
 * เช่น 0822222222 ผูกกับทั้งบ้าน 99/1 และ 99/1/2 — 1 บัญชีจึงต้องเห็นได้หลายบ้าน
 */
@Entity('account_members')
export class AccountMemberEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // อ้างถึง admin.id (บัญชีที่ล็อกอิน ไม่ว่าจะ role admin หรือ member)
  @Column({ name: 'account_id', type: 'int' })
  account_id!: number;

  // อ้างถึง members.id (บ้านที่บัญชีนี้มีสิทธิ์เห็นข้อมูล)
  @Column({ name: 'members_id', type: 'int' })
  members_id!: number;

  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
