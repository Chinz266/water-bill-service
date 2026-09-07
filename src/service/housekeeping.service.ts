import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { In, LessThan, Repository } from 'typeorm';
import { BillEntity } from '../entity/bill.entity';
import { MeterReadingEntity } from '../entity/meter-reading.entity';
import { UnassignedReadingEntity } from '../entity/unassigned-reading.entity';
import { BillsService } from './bills.service';
import { MeterPhotoService } from './meter-photo.service';

/**
 * งานเก็บกวาดที่รันเองตามเวลา — ลบรูปตามอายุ, ล้างขยะ, ดีดสถานะบิลเลยกำหนด
 *
 * ═══ ทำไมเพิ่งมามีตอนนี้ ═══
 *
 * เดิมตั้งใจไม่มี scheduler (ดู `markOverdue()`) เพราะสถานะที่ไม่มีใครเปิดดูก็ไม่มี
 * ความหมาย และการอัปเดตตอนอ่านให้ผลเหมือนกัน — เหตุผลนั้นยังถูกสำหรับ *สถานะ*
 *
 * แต่ไม่ถูกสำหรับ *พื้นที่ดิสก์*: รูปมิเตอร์เกิดทุกเดือน × ทุกบ้าน และไม่มีใคร
 * "เปิดดู" พื้นที่ที่หายไป มันหมดเงียบ ๆ แล้วระบบล้มตอนที่ยังต้องใช้งานอยู่
 * งานพวกนี้จึงต้องเกิดขึ้นเองแม้ไม่มีใครเข้าเว็บทั้งเดือน
 */
@Injectable()
export class HousekeepingService {
  private readonly logger = new Logger(HousekeepingService.name);

  /** โฟลเดอร์เดียวกับที่ MeterPhotoService เขียนไฟล์ลง */
  private readonly photoDir = join(process.cwd(), 'uploads', 'meters');

  /**
   * เก็บรูปหลักฐานไว้กี่วันหลังบิลถูกชำระ
   *
   * 1 ปีมาจากรอบการทักท้วง — ลูกบ้านที่จะเถียงเรื่องบิลจะเถียงภายในไม่กี่เดือน
   * ส่วนที่เกินหนึ่งปีไปแล้วแทบไม่มีใครย้อนกลับมาดู แต่พื้นที่ยังถูกกินอยู่ทุกวัน
   *
   * ⚠️ ลบเฉพาะบิลที่ **จ่ายแล้ว** เท่านั้น — บิลที่ยังค้างต่อให้ผ่านไปสามปี
   *    ก็ยังเป็นเรื่องที่ต้องตามเก็บ และรูปคือหลักฐานว่าหน่วยน้ำมาจากไหน
   */
  static readonly PHOTO_RETENTION_DAYS = 365;

  /** ข้อมูลกำพร้าที่ค้างเกินนี้ = ไม่มีใครจะกลับมาจับคู่แล้ว */
  static readonly UNASSIGNED_STALE_DAYS = 90;

  constructor(
    @InjectRepository(BillEntity)
    private readonly billRepository: Repository<BillEntity>,
    @InjectRepository(MeterReadingEntity)
    private readonly meterReadingRepository: Repository<MeterReadingEntity>,
    @InjectRepository(UnassignedReadingEntity)
    private readonly unassignedRepository: Repository<UnassignedReadingEntity>,
    private readonly meterPhotoService: MeterPhotoService,
    private readonly billsService: BillsService,
  ) {}

  /**
   * ดีดบิลที่เลยกำหนดเป็น Overdue ทุกวันตอนตี 1
   *
   * `markOverdue()` ยังถูกเรียกตอนอ่านเหมือนเดิมด้วย ไม่ได้เอาออก — สองทางนี้
   * ทำงานทับกันได้ไม่มีปัญหา (คิวรีเดียวกัน แตะเฉพาะแถวที่เข้าเงื่อนไข)
   *
   * ที่ต้องมีตัวนี้เพิ่มเพราะระบบแจ้งเตือนในอนาคตต้องอ่าน "สถานะที่ถูกต้อง ณ วันนี้"
   * โดยไม่มีใครเปิดหน้าเว็บก่อน — ซึ่งของเดิมทำไม่ได้
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async markOverdueBills(): Promise<number> {
    const affected = await this.billsService.markOverdue();
    if (affected > 0) {
      this.logger.log(`ดีดบิลที่เลยกำหนดเป็น Overdue จำนวน ${affected} ใบ`);
    }
    return affected;
  }

  /**
   * ลบรูปของบิลที่จ่ายแล้วและเก่าเกิน 1 ปี — ตี 3 ทุกวัน
   *
   * ═══ ทำไมไม่ล้าง evidence_photo เป็น NULL ═══
   *
   * path ที่ยังอยู่คือหลักฐานว่า "เคยมีรูป" ซึ่งต่างจาก NULL ที่แปลว่า "ไม่เคยถ่าย"
   * — สองอย่างนี้ต่างกันมากเวลาย้อนไปตรวจว่าเดือนนั้นทำงานครบไหม
   *
   * `photo_purged_at` จึงเป็นตัวบอกว่าไฟล์ถูกลบตามนโยบาย ไม่ใช่หายไปเอง
   * (หน้าเว็บต้องเช็คค่านี้ก่อนขึ้นรูป ไม่งั้นจะได้ 404)
   */
  @Cron('0 3 * * *')
  async purgeExpiredPhotos(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HousekeepingService.PHOTO_RETENTION_DAYS);

    // บิลที่จ่ายแล้วและถูกแตะครั้งสุดท้ายก่อน cutoff — ไล่จาก bills ไปหา readings
    // เพราะเงื่อนไข "จ่ายแล้ว" อยู่ที่ฝั่งบิล ส่วนรูปอยู่ที่ฝั่งการจด
    const paidOldBills = await this.billRepository.find({
      where: { payment_status: 'Paid', modify_date: LessThan(cutoff) },
      select: { id: true, meter_readings_id: true },
    });
    if (paidOldBills.length === 0) return 0;

    const readingIds = paidOldBills.map((bill) => bill.meter_readings_id);
    const readings = await this.meterReadingRepository.find({
      where: { id: In(readingIds) },
    });

    let purged = 0;
    for (const reading of readings) {
      if (!reading.evidence_photo || reading.photo_purged_at) continue;

      await this.meterPhotoService.remove(reading.evidence_photo);
      await this.meterReadingRepository.update(reading.id, {
        photo_purged_at: new Date(),
      });
      purged += 1;
    }

    if (purged > 0) {
      this.logger.log(
        `ลบรูปหลักฐานของบิลที่ชำระแล้วและเกิน ${HousekeepingService.PHOTO_RETENTION_DAYS} วัน จำนวน ${purged} ไฟล์`,
      );
    }
    return purged;
  }

  /**
   * ตีทิ้งข้อมูลกำพร้าที่ค้างคิวนานเกินไป — ตี 3 ครึ่ง ทุกวัน
   *
   * รูปที่ไม่มีใครจับคู่ภายใน 90 วันคือรูปที่จับคู่ไม่ได้แล้วจริง ๆ — เดือนนั้น
   * ปิดบัญชีไปหลายรอบแล้ว การไปออกบิลย้อนหลังจะไปชนด่าน "มีบิลใหม่กว่าอยู่"
   * ทันที เก็บไว้ต่อจึงมีแต่ไฟล์ที่กินดิสก์โดยไม่มีวันถูกใช้
   */
  @Cron('30 3 * * *')
  async discardStaleUnassigned(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(
      cutoff.getDate() - HousekeepingService.UNASSIGNED_STALE_DAYS,
    );

    const stale = await this.unassignedRepository.find({
      where: { status: 'Pending', create_date: LessThan(cutoff) },
    });

    for (const row of stale) {
      await this.meterPhotoService.remove(row.evidence_photo);
      await this.unassignedRepository.update(row.id, {
        status: 'Discarded',
        note: `ตีทิ้งอัตโนมัติ: ค้างคิวเกิน ${HousekeepingService.UNASSIGNED_STALE_DAYS} วัน`,
        resolved_date: new Date(),
      });
    }

    if (stale.length > 0) {
      this.logger.log(
        `ตีทิ้งข้อมูลกำพร้าที่ค้างนานเกินไป ${stale.length} รายการ`,
      );
    }
    return stale.length;
  }

  /**
   * ลบไฟล์รูปที่ไม่มีแถวไหนในฐานข้อมูลอ้างถึงแล้ว — ทุกวันอาทิตย์ตี 4
   *
   * ═══ ไฟล์กำพร้ามาจากไหน ═══
   *
   * ทุกเส้นทางที่เขียนรูปจะเขียนไฟล์ **ก่อน** เข้าทรานแซกชัน เพราะการเขียนดิสก์
   * ย้อนกลับพร้อม rollback ไม่ได้ โค้ดมี catch ตามลบให้อยู่แล้ว แต่ครอบไม่ได้ทุกกรณี:
   * process ถูกฆ่ากลางคัน / ไฟดับ / คำสั่ง unlink เองล้มเหลว
   *
   * กวาดสัปดาห์ละครั้งพอ เพราะเป็นเคสที่เกิดไม่บ่อย และการอ่านรายชื่อไฟล์ทั้งโฟลเดอร์
   * มาเทียบกับฐานข้อมูลเป็นงานที่หนักกว่าตัวอื่นในไฟล์นี้มาก
   */
  @Cron('0 4 * * 0')
  async removeOrphanPhotoFiles(): Promise<number> {
    let files: string[];
    try {
      files = await readdir(this.photoDir);
    } catch {
      // ยังไม่เคยมีการอัปรูปเลย โฟลเดอร์จึงยังไม่ถูกสร้าง — ไม่ใช่ความผิดพลาด
      return 0;
    }
    if (files.length === 0) return 0;

    // โหลด path ที่ยังถูกอ้างถึงทั้งหมดมาเป็น Set ครั้งเดียว
    // ถ้าเช็คทีละไฟล์ด้วยคิวรีจะกลายเป็นหลายพันคิวรีต่อการกวาดหนึ่งรอบ
    const referenced = new Set<string>();
    const readings = await this.meterReadingRepository.find({
      select: { id: true, evidence_photo: true },
    });
    for (const reading of readings) {
      if (reading.evidence_photo) referenced.add(reading.evidence_photo);
    }
    const unassigned = await this.unassignedRepository.find({
      select: { id: true, evidence_photo: true },
    });
    for (const row of unassigned) {
      if (row.evidence_photo) referenced.add(row.evidence_photo);
    }

    let removed = 0;
    for (const name of files) {
      const storedPath = `/uploads/meters/${name}`;
      if (referenced.has(storedPath)) continue;

      await this.meterPhotoService.remove(storedPath);
      removed += 1;
    }

    if (removed > 0) {
      this.logger.log(`ลบไฟล์รูปที่ไม่มีใครอ้างถึงแล้ว ${removed} ไฟล์`);
    }
    return removed;
  }

  /**
   * สรุปว่ามีอะไรรอเก็บกวาดอยู่บ้าง — ให้หน้า Admin เรียกดูได้โดยไม่ต้องรอ cron
   *
   * ไม่ลบอะไรทั้งสิ้น เป็นการนับอย่างเดียว เพราะคนที่กดดูควรเห็นก่อนว่าจะหายอะไรไป
   */
  async status() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HousekeepingService.PHOTO_RETENTION_DAYS);

    const staleCutoff = new Date();
    staleCutoff.setDate(
      staleCutoff.getDate() - HousekeepingService.UNASSIGNED_STALE_DAYS,
    );

    const [purgeablePhotos, pendingUnassigned, staleUnassigned] =
      await Promise.all([
        this.billRepository.count({
          where: { payment_status: 'Paid', modify_date: LessThan(cutoff) },
        }),
        this.unassignedRepository.count({ where: { status: 'Pending' } }),
        this.unassignedRepository.count({
          where: { status: 'Pending', create_date: LessThan(staleCutoff) },
        }),
      ]);

    return {
      photo_retention_days: HousekeepingService.PHOTO_RETENTION_DAYS,
      /** บิลที่จ่ายแล้วและเก่าพอจะลบรูปได้ (บางใบอาจถูกลบไปแล้ว) */
      purgeable_paid_bills: purgeablePhotos,
      pending_unassigned: pendingUnassigned,
      /** ข้อมูลกำพร้าที่ค้างนานจนจะถูกตีทิ้งอัตโนมัติ */
      stale_unassigned: staleUnassigned,
    };
  }
}
