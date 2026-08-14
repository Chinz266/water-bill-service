import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * เรื่องที่ลูกบ้านแจ้งเข้ามาหาผู้ดูแลหมู่บ้าน (1 แถว = 1 เรื่อง)
 * ดูโครงสร้างตารางจริงที่ db/migrate-reports.sql
 */
@Entity('reports')
export class ReportEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // บ้านที่เรื่องนี้อ้างถึง
  @Column({ type: 'int' })
  members_id!: number;

  // บัญชีลูกบ้านที่กดส่ง (อ้าง admin.id — admin เป็นตารางบัญชีร่วม แยกด้วย role)
  @Column({ type: 'int' })
  account_id!: number;

  @Column({ type: 'varchar', length: 45 })
  category!: string;

  @Column({ type: 'text' })
  detail!: string;

  // รูปประกอบแบบ base64 data URL (ย่อจากฝั่งเว็บแล้ว) — เหมือน admin.photo
  @Column({ type: 'mediumtext', nullable: true })
  photo!: string | null;

  // 🌟 ตัวพิมพ์ต้องตรงกับ enum ใน Database: ('Pending','InProgress','Resolved')
  @Column({
    type: 'enum',
    enum: ['Pending', 'InProgress', 'Resolved'],
    default: 'Pending',
  })
  status!: 'Pending' | 'InProgress' | 'Resolved';

  @Column({ type: 'text', nullable: true })
  admin_reply!: string | null;

  @Column({ type: 'int', nullable: true })
  replied_by!: number | null;

  @Column({ type: 'datetime', nullable: true })
  replied_date!: Date | null;

  // ✅ ใช้ @CreateDateColumn ได้ เพราะตารางนี้เราสร้างเองและใส่ DEFAULT CURRENT_TIMESTAMP ไว้แล้ว
  //    (ต่างจากตารางเก่าอย่าง water_rates/meter_readings ที่เป็น `date NOT NULL` ไม่มี default
  //     จนต้องให้ service เซ็ตค่าเอง ไม่งั้น MySQL เขียน '0000-00-00' ให้)
  @CreateDateColumn({ name: 'create_date' })
  create_date!: Date;

  @Column({ type: 'datetime', nullable: true })
  modify_date!: Date | null;
}
