import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * บัญชีลูกบ้าน — คนละทะเบียนกับ AdminEntity (ผู้ดูแลหมู่บ้าน)
 *
 * เดิมสองอย่างนี้อยู่ในตาราง `admin` ตารางเดียวกันแล้วแยกด้วยคอลัมน์ `role`
 * ซึ่งทำให้ `GET /admin/all` คืนบัญชีลูกบ้านปนออกไป และทำให้ "ใครเป็นผู้ดูแล"
 * ขึ้นอยู่กับค่าในคอลัมน์ที่ UPDATE ผิดครั้งเดียวก็พลิกได้
 * ตอนนี้คำตอบมาจากตารางที่บัญชีนั้นอยู่แทน (ดู db/migrate-accounts-table.sql)
 *
 * ⚠️ ไม่มีคอลัมน์รหัสผ่านโดยตั้งใจ — ลูกบ้านเข้าด้วยเบอร์อย่างเดียว
 *    (เหตุผลอยู่ที่ AuthService.loginMember) สิทธิ์เห็นบ้านหลังไหนคุมที่
 *    `account_members` เสมอ ไม่ได้คุมที่ตัวบัญชี
 */
@Entity('accounts')
export class AccountEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // เบอร์ = ชื่อผู้ใช้ จึงต้อง unique (คนละเรื่องกับ members.phone ที่เป็น
  // เบอร์ติดต่อของบ้าน ซึ่งซ้ำกันได้ระหว่างบ้าน)
  @Column({ type: 'varchar', length: 20, unique: true })
  phone!: string;

  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;
}
