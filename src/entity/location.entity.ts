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

  @Column({ length: 150 })
  name_in_english!: string;

  @Column()
  district_id!: number;

  @Column({ nullable: true })
  zip_code!: number;
}
