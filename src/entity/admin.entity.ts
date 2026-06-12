import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin')
export class AdminEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 45, nullable: true })
  fname!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  lname!: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  password!: string;

  @Column({ type: 'varchar', length: 45, nullable: true })
  role!: string;
}