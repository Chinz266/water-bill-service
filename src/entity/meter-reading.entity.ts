import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('meter_readings')
export class MeterReadingEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'date', name: 'reading_date', nullable: true })
  readingDate!: Date;

  @Column({ type: 'int', name: 'meter_unit', nullable: true })
  meterUnit!: number;

  @Column({ type: 'varchar', length: 100, name: 'evidence_photo', nullable: true })
  evidencePhoto!: string;

  @Column({ type: 'int', name: 'members_id', nullable: true })
  membersId!: number;

  @Column({ type: 'datetime', name: 'create_date' })
  createDate!: Date;

  @Column({ type: 'int', name: 'create_by', nullable: true })
  createBy!: number;

  @Column({ type: 'datetime', name: 'modify_date', nullable: true })
  modifyDate!: Date;

  @Column({ type: 'int', name: 'modify_by', nullable: true })
  modifyBy!: number;
}
