import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin')
export class AdminEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  fname!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  lname!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  email!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string;

  // 🌟 ต้องยาว 255 เพราะเก็บ bcrypt hash (60 ตัว) ถ้าเหลือ 45 hash จะถูกตัดแล้วล็อกอินไม่ได้ตลอดกาล
  @Column({ type: 'varchar', length: 255, nullable: true })
  password!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  role!: string;

  @Column({ type: 'datetime', name: 'create_date' })
  createDate!: Date;

  @Column({ type: 'int', name: 'create_by', nullable: true })
  createBy!: number;

  @Column({ type: 'int', name: 'modify_by', nullable: true })
  modifyBy!: number;

  @Column({ type: 'datetime', name: 'modify_date', nullable: true })
  modifyDate!: Date;
}