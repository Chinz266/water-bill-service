import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('water_rates') // กำหนดชื่อตารางให้ตรงกับใน Database
export class WaterRateEntity {
  
  @PrimaryGeneratedColumn() 
  id!: number;

  @Column('decimal', { precision: 10, scale: 2 }) 
  price_per_unit!: number;

  // 🌟 ตัวพิมพ์ต้องตรงกับ enum ใน Database: ('Active','Inactive')
  @Column({ type: 'enum', enum: ['Active', 'Inactive'], default: 'Active' })
  status!: 'Active' | 'Inactive';

  @Column()
  create_by!: number;

  @CreateDateColumn() 
  create_date!: Date;

  @Column({ nullable: true }) 
  modify_by!: number;

  @UpdateDateColumn() 
  modify_date!: Date;
}