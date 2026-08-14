import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin')
export class AdminEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  fname!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  lname!: string;

  // 🌟 nullable เพราะบัญชีลูกบ้าน (role='member') ไม่มีอีเมล ล็อกอินด้วยเบอร์แทน
  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  email!: string | null;

  // 🌟 unique เพราะเป็น "username" ของบัญชีลูกบ้าน (คนละเรื่องกับ members.phone
  //    ที่เป็นเบอร์ติดต่อของบ้าน ซึ่งซ้ำกันได้ระหว่างบ้าน)
  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  phone!: string | null;

  // 🌟 ต้องยาว 255 เพราะเก็บ bcrypt hash (60 ตัว) ถ้าเหลือ 45 hash จะถูกตัดแล้วล็อกอินไม่ได้ตลอดกาล
  @Column({ type: 'varchar', length: 255, nullable: true })
  password!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  role!: string;

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
