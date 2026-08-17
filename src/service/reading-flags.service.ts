import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { MemberEntity } from '../entity/member.entity';
import {
  READING_FLAG_TYPES,
  ReadingFlagEntity,
  ReadingFlagType,
} from '../entity/reading-flag.entity';

/** ธงหนึ่งใบที่รอเขียนลงฐานข้อมูลพร้อมกับการจด */
export interface PendingFlag {
  flag_type: ReadingFlagType;
  detail?: string | null;
  /** admin.id ของคนที่กดยืนยันข้ามด่าน — ไม่ใส่ = ระบบติดธงเอง */
  confirmed_by?: number | null;
}

/**
 * บันทึกร่องรอยว่าการจดครั้งไหนติดธงอะไร และใครกดผ่าน
 *
 * ═══ ทำไมต้องเขียนใน manager เดียวกับบิล ═══
 *
 * ธงคือหลักฐานว่า "ตอนออกบิลใบนี้ระบบเตือนอะไรไว้" ถ้าเขียนแยกทรานแซกชัน
 * แล้วบิล rollback จะเหลือธงที่ชี้ไปการจดที่ไม่มีอยู่จริง (หรือกลับกัน — บิลผ่าน
 * แต่ธงหาย ซึ่งแย่กว่า เพราะกลายเป็นบิลที่ดูสะอาดทั้งที่กดข้ามด่านมา)
 *
 * เมธอด record() จึงรับ manager เข้ามาเสมอ ไม่ยิงผ่าน repository ของตัวเอง
 */
@Injectable()
export class ReadingFlagsService {
  constructor(
    @InjectRepository(ReadingFlagEntity)
    private readonly flagRepository: Repository<ReadingFlagEntity>,
  ) {}

  /** เขียนธงทั้งชุดของการจดครั้งหนึ่ง — เรียกภายในทรานแซกชันที่สร้างการจดนั้น */
  async record(
    manager: EntityManager,
    meterReadingsId: number,
    flags: PendingFlag[],
  ): Promise<void> {
    if (flags.length === 0) return;

    await manager.save(
      flags.map((flag) =>
        manager.create(ReadingFlagEntity, {
          meter_readings_id: meterReadingsId,
          flag_type: flag.flag_type,
          detail: flag.detail ?? null,
          confirmed_by: flag.confirmed_by ?? null,
        }),
      ),
    );
  }

  /**
   * ธงที่ติดไว้ พร้อมบ้านและวันที่จด — ใช้ทำหน้า "รายการที่ต้องสอบทาน"
   *
   * เรียงใหม่สุดขึ้นก่อน และจำกัดจำนวนเสมอ เพราะตารางนี้โตทุกเดือนโดยไม่มีวันลด
   *
   * ═══ อ่านผลยังไงให้ถูก ═══
   *
   * ธงใบเดียวแทบไม่ได้แปลว่ามีอะไรผิด — พิกัดซ้ำครั้งเดียวเกิดจากหน้าเว็บ cache
   * พิกัดไว้ก็ได้ สิ่งที่บอกอะไรจริงคือ **ความถี่ต่อคน**: คนที่ติดธงเดิมซ้ำ ๆ
   * ทุกเดือนคือสัญญาณ ส่วนคนที่ติดครั้งเดียวในรอบปีคือเรื่องปกติของหน้างาน
   */
  async findAll(params: {
    flag_type?: string;
    members_id?: number;
    limit?: number;
  }) {
    const flagType = READING_FLAG_TYPES.find(
      (value) => value === params.flag_type,
    );

    const query = this.flagRepository
      .createQueryBuilder('flag')
      .leftJoin(
        MeterReadingEntity,
        'reading',
        'reading.id = flag.meter_readings_id',
      )
      .leftJoin(MemberEntity, 'member', 'member.id = reading.members_id1')
      .addSelect([
        'reading.reading_date',
        'reading.meter_unit',
        'reading.entry_method',
        'member.id',
        'member.house_no',
        'member.fname',
        'member.lname',
      ])
      .orderBy('flag.create_date', 'DESC')
      // เพดานตายตัว — หน้าเว็บส่ง limit มหาศาลมาแล้วลากทั้งตารางไม่ได้
      .limit(Math.min(Math.max(params.limit ?? 100, 1), 500));

    if (flagType) {
      query.andWhere('flag.flag_type = :flagType', { flagType });
    }
    if (params.members_id) {
      query.andWhere('reading.members_id1 = :membersId', {
        membersId: params.members_id,
      });
    }

    const { entities, raw } = await query.getRawAndEntities<{
      reading_reading_date?: Date | null;
      reading_meter_unit?: number | null;
      reading_entry_method?: string | null;
      member_id?: number | null;
      member_house_no?: string | null;
      member_fname?: string | null;
      member_lname?: string | null;
    }>();

    return entities.map((flag, index) => {
      const row = raw[index];
      return {
        ...flag,
        reading: {
          reading_date: row?.reading_reading_date ?? null,
          meter_unit: row?.reading_meter_unit ?? null,
          entry_method: row?.reading_entry_method ?? null,
        },
        member: row?.member_id
          ? {
              id: row.member_id,
              house_no: row.member_house_no,
              name: `${row.member_fname ?? ''} ${row.member_lname ?? ''}`.trim(),
            }
          : null,
      };
    });
  }

  /**
   * สรุปจำนวนธงแยกตามชนิดในช่วงที่ผ่านมา — ตัวเลขที่บอกว่าด่านไหนเริ่มไร้ความหมาย
   *
   * ด่านที่ถูกกดผ่านเกือบทุกใบแปลว่าเกณฑ์ตั้งไว้แน่นเกินของจริง ควรปรับเกณฑ์
   * ไม่ใช่ปล่อยให้คนกดผ่านต่อไป เพราะนิสัยกดผ่านจะลามไปถึงใบที่ผิดจริง
   */
  async summary(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, days));

    const rows = await this.flagRepository
      .createQueryBuilder('flag')
      .select('flag.flag_type', 'flag_type')
      .addSelect('COUNT(*)', 'total')
      .addSelect(
        'SUM(CASE WHEN flag.confirmed_by IS NULL THEN 0 ELSE 1 END)',
        'confirmed_by_person',
      )
      .where('flag.create_date >= :since', { since })
      .groupBy('flag.flag_type')
      .orderBy('total', 'DESC')
      .getRawMany<{
        flag_type: string;
        total: string;
        confirmed_by_person: string;
      }>();

    // COUNT/SUM ของ MySQL กลับมาเป็น string ต้องแปลงก่อนส่งออก
    return {
      since,
      days,
      flags: rows.map((row) => ({
        flag_type: row.flag_type,
        total: Number(row.total),
        confirmed_by_person: Number(row.confirmed_by_person),
      })),
    };
  }
}
