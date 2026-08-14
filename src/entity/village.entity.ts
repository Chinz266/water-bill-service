import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('villages') // กำหนดชื่อตารางให้ตรงกับใน Database
export class VillageEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  provinces_id!: number;

  @Column()
  districts_id!: number;

  @Column()
  subdistricts_id!: number;

  @Column({ length: 200 })
  village_name!: string;

  @Column({ length: 45 })
  village_no!: string;

  @Column({ length: 45, nullable: true })
  headman_name!: string;

  @Column({ length: 45, nullable: true })
  deputy_headman_name!: string;

  @Column({ length: 45, nullable: true })
  phone!: string;

  @Column({ length: 45, default: 'EVERY_MONTH' })
  billing_month!: string;

  @Column()
  create_by!: number;

  // 🌟 ชื่อคอลัมน์จริงใน DB สะกดว่า craeta_date
  @CreateDateColumn({ name: 'craeta_date' })
  create_date!: Date;

  @Column({ nullable: true })
  modify_by!: number;

  @UpdateDateColumn()
  modify_date!: Date;
}
