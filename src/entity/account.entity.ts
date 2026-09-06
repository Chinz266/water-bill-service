import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** บัญชีลูกบ้าน แยกจากตาราง admin และเข้าสู่ระบบด้วยเบอร์โทร */
@Entity('accounts')
export class AccountEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 20, unique: true })
  phone!: string;

  @CreateDateColumn({ name: 'create_date' })
  createDate!: Date;
}
