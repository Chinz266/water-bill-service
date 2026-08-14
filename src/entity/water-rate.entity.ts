import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

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

  // ⚠️ ห้ามใช้ @CreateDateColumn / @UpdateDateColumn กับคอลัมน์พวกนี้
  // เพราะ TypeORM จะส่ง DEFAULT ลง INSERT โดยหวังว่า DB มี DEFAULT CURRENT_TIMESTAMP
  // แต่ schema จริงเป็น `date NOT NULL` ที่ไม่มี default → MySQL เขียน '0000-00-00' ให้แทน
  // จึงประกาศเป็น @Column ธรรมดา แล้วให้ service เซ็ตค่าเองตอนสร้าง (ดู meter_readings.reading_date)
  @Column({ type: 'date' })
  create_date!: Date;

  @Column({ nullable: true })
  modify_by!: number;

  @Column({ type: 'date', nullable: true })
  modify_date!: Date | null;
}
