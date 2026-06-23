import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('water_rates') // กำหนดชื่อตารางให้ตรงกับใน Database
export class WaterRateEntity {
  
  @PrimaryGeneratedColumn() 
  id!: number;

  @Column('decimal', { precision: 10, scale: 2 }) 
  price_per_unit!: number;

  @Column({ type: 'enum', enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  status!: 'ACTIVE' | 'INACTIVE';

  @Column()
  create_by!: number;

  @CreateDateColumn() 
  create_date!: Date;

  @Column({ nullable: true }) 
  modify_by!: number;

  @UpdateDateColumn() 
  modify_date!: Date;
}