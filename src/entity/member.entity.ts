import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('member')
export class MemberEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  fname!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  lname!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string;

  @Column({ type: 'text', nullable: true })
  address!: string;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status!: string;

  @Column({ type: 'datetime', name: 'create_date' })
  createDate!: Date;

  @Column({ type: 'int', name: 'create_by', nullable: true })
  createBy!: number;

  @Column({ type: 'int', name: 'modify_by', nullable: true })
  modifyBy!: number;

  @Column({ type: 'datetime', name: 'modify_date', nullable: true })
  modifyDate!: Date;
}
