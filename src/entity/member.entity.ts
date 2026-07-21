import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('members') // 🌟 อย่าลืมเช็คชื่อตารางอีกรอบนะครับ
export class MemberEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id!: number;

  // 🌟 เปลี่ยนกลับมาใช้ชื่อ fname และ lname ให้ตรงกับที่ Service เรียกหา
  @Column({ name: 'fname', type: 'varchar', length: 45, nullable: true })
  fname!: string;

  @Column({ name: 'lname', type: 'varchar', length: 45, nullable: true })
  lname!: string;

  // 🌟 ปรับตัวแปรอื่นๆ ให้เป็น snake_case ตามโค้ดเดิมของลูกพี่เลยครับ จะได้ไม่พังจุดอื่น
  @Column({ name: 'house_no', type: 'varchar', length: 45, nullable: true })
  house_no!: string;

  @Column({ name: 'phone', type: 'varchar', length: 20, nullable: true })
  phone!: string;

  @Column({
    name: 'latitude',
    type: 'decimal',
    precision: 10,
    scale: 8,
    nullable: true,
  })
  latitude!: number;

  @Column({
    name: 'longitude',
    type: 'decimal',
    precision: 10,
    scale: 8,
    nullable: true,
  })
  longitude!: number;

  @Column({ name: 'villages_id', type: 'int' })
  villages_id!: number;

  @Column({ name: 'craeta_date', type: 'date' })
  craeta_date!: Date;

  @Column({ name: 'craete_by', type: 'int' })
  craete_by!: number;

  @Column({ name: 'modify_by', type: 'int', nullable: true })
  modify_by!: number;

  @Column({ name: 'modify_date', type: 'date', nullable: true })
  modify_date!: Date;
}
