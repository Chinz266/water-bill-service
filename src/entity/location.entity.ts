import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * ตารางเขตการปกครองไทย (ข้อมูลอ้างอิง อ่านอย่างเดียว)
 * จังหวัด → อำเภอ → ตำบล ใช้ทำ dropdown เลือกที่อยู่ของหมู่บ้าน
 */

@Entity('provinces')
export class ProvinceEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  code!: number;

  @Column({ length: 150 })
  name_in_thai!: string;

  @Column({ length: 150 })
  name_in_english!: string;
}

@Entity('districts')
export class DistrictEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  code!: number;

  @Column({ length: 150 })
  name_in_thai!: string;

  @Column({ length: 150 })
  name_in_english!: string;

  @Column()
  province_id!: number;
}

@Entity('subdistricts')
export class SubdistrictEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  code!: number;

  @Column({ length: 150 })
  name_in_thai!: string;

  // 🌟 ข้อมูลตำบล 271 แถวไม่มีชื่ออังกฤษจริง ๆ (เช็คจากข้อมูลในดัมป์แล้ว)
  //    ประกาศเป็น non-null ไว้เฉย ๆ ทำให้โค้ดที่อ่านค่าไปต่อไม่ต้องเช็ค null
  //    ทั้งที่มีโอกาสเจอ null จริง — คนละเรื่องกับ provinces/districts ที่ครบทุกแถว
  // ต้องระบุ type ตรง ๆ — TypeORM เดาชนิดจาก `string | null` ไม่ได้ (มองเป็น Object)
  @Column({ type: 'varchar', length: 150, nullable: true })
  name_in_english!: string | null;

  @Column()
  district_id!: number;

  @Column({ nullable: true })
  zip_code!: number;
}
