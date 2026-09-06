import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin')
export class AdminEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  fname!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  lname!: string;

  // nullable เพราะแถวเก่าบางแถวยังไม่ได้กรอกอีเมล — บัญชีที่เปิดใหม่ต้องมีเสมอ
  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  phone!: string | null;

  // 🌟 ต้องยาว 255 เพราะเก็บ bcrypt hash (60 ตัว) ถ้าเหลือ 45 hash จะถูกตัดแล้วล็อกอินไม่ได้ตลอดกาล
  @Column({ type: 'varchar', length: 255, nullable: true })
  password!: string;

  // 🌟 สิทธิ์ของผู้ดูแล — ตอบว่า "แก้ของเก่าได้แค่ไหน"
  //    (owner แก้บิลย้อนหลังได้ / staff แก้ได้จำกัด)
  //    ค่าเริ่มต้นเป็น staff เสมอ เพราะ POST /auth/register เป็น endpoint สาธารณะ —
  //    บัญชีที่เปิดเองต้องไม่ได้สิทธิ์แก้ยอดเงินย้อนหลังติดมาด้วย
  //
  //    ⚠️ ไม่มีคอลัมน์ role แล้ว — ทุกแถวในตารางนี้คือผู้ดูแล บัญชีลูกบ้านย้ายไป
  //       ตาราง accounts (ดู AccountEntity + db/migrate-accounts-table.sql)
  @Column({ type: 'enum', enum: ['owner', 'staff'], default: 'staff' })
  admin_role!: 'owner' | 'staff';

  // 🌟 รูปโปรไฟล์ผู้ดูแล เก็บเป็น base64 data URL (ย่อขนาดจากฝั่งเว็บก่อนแล้ว)
  //    MEDIUMTEXT เพราะ varchar สั้นเกินเก็บ base64 ไม่พอ
  @Column({ type: 'mediumtext', nullable: true })
  photo!: string | null;

  @Column({ type: 'datetime', name: 'create_date' })
  createDate!: Date;

  @Column({ type: 'int', name: 'create_by', nullable: true })
  createBy!: number;

  @Column({ type: 'int', name: 'modify_by', nullable: true })
  modifyBy!: number;

  @Column({ type: 'datetime', name: 'modify_date', nullable: true })
  modifyDate!: Date;
}
