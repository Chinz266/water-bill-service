import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MeterReadingLogEntity } from '../entity/meter-reading-log.entity';
import { AdminEntity } from '../entity/admin.entity';
import { MemberEntity } from '../entity/member.entity';

/** การแก้หนึ่งครั้งที่รอเขียนลงฐานข้อมูลพร้อมกับบิลที่ถูกแก้ */
export interface PendingReadingLog {
  bills_id: number;
  meter_readings_id: number;
  members_id: number | null;
  old_unit: number;
  new_unit: number;
  old_usage_unit: number;
  new_usage_unit: number;
  old_total_amount: number;
  new_total_amount: number;
  reason: string;
  photo_replaced: boolean;
  /** ด่านที่ถูกกดยืนยันข้ามในการแก้ครั้งนี้ */
  confirmed_flags: string[];
  changed_by: number | null;
  changed_role: 'owner' | 'staff' | null;
}

/**
 * บันทึกว่าใครแก้เลขมิเตอร์ของบิลใบไหน จากเท่าไหร่เป็นเท่าไหร่ ด้วยเหตุผลอะไร
 *
 * ═══ ทำไม record() ต้องรับ manager เข้ามา ═══
 *
 * log คือหลักฐานของการแก้ ถ้าเขียนแยกทรานแซกชันแล้วการแก้ rollback จะเหลือ log
 * ของการแก้ที่ไม่เคยเกิดขึ้น — หรือแย่กว่านั้น: บิลถูกแก้สำเร็จแต่ log หาย
 * ซึ่งได้ผลลัพธ์เหมือนกับไม่เคยมีตารางนี้เลย (เหตุผลเดียวกับ ReadingFlagsService)
 */
@Injectable()
export class ReadingLogsService {
  constructor(
    @InjectRepository(MeterReadingLogEntity)
    private readonly logRepository: Repository<MeterReadingLogEntity>,
  ) {}

  /** เขียน log ของการแก้ — เรียกภายในทรานแซกชันเดียวกับที่แก้บิล */
  async record(
    manager: EntityManager,
    log: PendingReadingLog,
  ): Promise<MeterReadingLogEntity> {
    return await manager.save(
      manager.create(MeterReadingLogEntity, {
        ...log,
        photo_replaced: log.photo_replaced ? 1 : 0,
        confirmed_flags:
          log.confirmed_flags.length > 0 ? log.confirmed_flags.join(',') : null,
      }),
    );
  }

  /**
   * ประวัติการแก้ ใหม่สุดขึ้นก่อน — ใช้ทำหน้า "บิลใบนี้ถูกแก้อะไรมาบ้าง"
   *
   * ไม่ join แบบ FK เพราะตารางนี้ตั้งใจไม่ผูก FK ไว้เลย (log ต้องอยู่ต่อแม้บิล
   * หรือการจดจะถูกลบ) จึงเป็น leftJoin ล้วน ๆ — แถวที่อ้างถึงของที่หายไปแล้ว
   * ยังคืนออกมาได้ตามปกติ โดยมีชื่อบ้าน/ชื่อคนแก้เป็น null
   */
  async findAll(params: { bills_id?: number; limit?: number }) {
    const query = this.logRepository
      .createQueryBuilder('log')
      .leftJoin(MemberEntity, 'member', 'member.id = log.members_id')
      .leftJoin(AdminEntity, 'admin', 'admin.id = log.changed_by')
      .addSelect([
        'member.house_no',
        'admin.fname',
        'admin.lname',
        'admin.email',
      ])
      .orderBy('log.create_date', 'DESC')
      .addOrderBy('log.id', 'DESC')
      // เพดานตายตัว — ตารางนี้โตทุกครั้งที่มีคนแก้บิลโดยไม่มีวันลด
      .limit(Math.min(Math.max(params.limit ?? 100, 1), 500));

    if (params.bills_id) {
      query.andWhere('log.bills_id = :billsId', { billsId: params.bills_id });
    }

    const { entities, raw } = await query.getRawAndEntities<{
      member_house_no?: string | null;
      admin_fname?: string | null;
      admin_lname?: string | null;
      admin_email?: string | null;
    }>();

    return entities.map((log, index) => {
      const row = raw[index];
      const name = `${row?.admin_fname ?? ''} ${row?.admin_lname ?? ''}`.trim();
      return {
        ...log,
        // decimal ของ MySQL กลับมาเป็น string ต้องแปลงก่อนส่งให้หน้าเว็บเอาไปลบกัน
        old_total_amount: Number(log.old_total_amount),
        new_total_amount: Number(log.new_total_amount),
        house_no: row?.member_house_no ?? null,
        changed_by_name: name || row?.admin_email || null,
      };
    });
  }
}
