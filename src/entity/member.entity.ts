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

  // ⚠️ precision ต้องเป็น 11 ไม่ใช่ 10 เหมือน latitude
  //    decimal(10,8) เหลือที่หน้าจุดแค่ 2 หลัก = สูงสุด 99.99999999
  //    แต่ลองจิจูดไทยอยู่ที่ 97–106 (3 หลัก) ค่าอย่าง 102.09 จึงล้นทุกครั้ง
  //    → MySQL strict mode เด้ง error 1264, ถ้าไม่ strict จะตัดเหลือ 99.99999999 เงียบ ๆ
  //    (latitude ไม่มีปัญหา ไทยอยู่ 5–20 = 2 หลัก พอดี decimal(10,8))
  @Column({
    name: 'longitude',
    type: 'decimal',
    precision: 11,
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
