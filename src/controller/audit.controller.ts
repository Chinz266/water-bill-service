import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReadingFlagsService } from 'src/service/reading-flags.service';
import { ReadingLogsService } from 'src/service/reading-logs.service';
import { HousekeepingService } from 'src/service/housekeeping.service';
import { Roles } from 'src/auth/roles.decorator';

/**
 * หน้าสอบทานของผู้ดูแล — ธงที่ระบบติดไว้ และงานเก็บกวาดระบบ
 *
 * แยกออกมาจาก /bills เพราะคนละคำถาม: /bills ตอบว่า "ใครต้องจ่ายเท่าไหร่"
 * ส่วนที่นี่ตอบว่า "ข้อมูลที่เอาไปคิดเงินนั้นเชื่อได้แค่ไหน"
 */
@ApiTags('Audit (สอบทาน / เก็บกวาดระบบ)')
@Roles('admin')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(
    private readonly readingFlagsService: ReadingFlagsService,
    private readonly readingLogsService: ReadingLogsService,
    private readonly housekeepingService: HousekeepingService,
  ) {}

  @Get('reading-logs')
  @ApiOperation({
    summary: 'ประวัติการแก้เลขมิเตอร์หลังออกบิล (ใหม่สุดขึ้นก่อน)',
    description:
      'ทุกครั้งที่มีคนยิง PATCH /bills/:id/reading จะมีแถวหนึ่งลงที่นี่ — เก็บทั้งเลขเดิม/เลขใหม่ ' +
      'ยอดเดิม/ยอดใหม่ เหตุผลที่แก้ ใครแก้ และสิทธิ์ของคนนั้น ณ ตอนแก้\n\n' +
      'ส่ง `bills_id` มาเพื่อดูเฉพาะใบเดียว (หน้ารายละเอียดบิล) ไม่ส่งมาจะได้การแก้ล่าสุดทั้งระบบ\n\n' +
      '⚠️ ตารางนี้ไม่ผูก FK กับ bills โดยตั้งใจ — log ต้องอยู่ต่อแม้บิลจะถูกลบทีหลัง ' +
      'แถวที่ชี้ไปบิลที่ไม่มีแล้วจึงเป็นเรื่องปกติ ไม่ใช่ข้อมูลเสีย',
  })
  async readingLogs(
    @Query('bills_id') billsId?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.readingLogsService.findAll({
      bills_id: billsId ? +billsId : undefined,
      limit: limit ? +limit : undefined,
    });
  }

  @Get('flags')
  @ApiOperation({
    summary: 'ธงที่ติดไว้กับการจดมิเตอร์ (ใหม่สุดขึ้นก่อน)',
    description:
      '⚠️ ธงใบเดียวแทบไม่ได้แปลว่ามีอะไรผิด — พิกัดซ้ำครั้งเดียวเกิดจากหน้าเว็บ cache ' +
      'พิกัดไว้ก็ได้\n\nสิ่งที่บอกอะไรจริงคือ **ความถี่ต่อคน**: คนที่ติดธงเดิมซ้ำ ๆ ทุกเดือน ' +
      'คือสัญญาณ ส่วนคนที่ติดครั้งเดียวในรอบปีคือเรื่องปกติของหน้างาน',
  })
  async flags(
    @Query('flag_type') flagType?: string,
    @Query('members_id') membersId?: string,
    @Query('limit') limit?: string,
  ) {
    return await this.readingFlagsService.findAll({
      flag_type: flagType,
      members_id: membersId ? +membersId : undefined,
      limit: limit ? +limit : undefined,
    });
  }

  @Get('flags/summary')
  @ApiOperation({
    summary: 'สรุปจำนวนธงแยกตามชนิดในช่วงที่ผ่านมา',
    description:
      'ตัวเลขที่บอกว่าด่านไหนเริ่มไร้ความหมาย — ด่านที่ถูกกดผ่านเกือบทุกใบแปลว่า ' +
      'เกณฑ์ตั้งไว้แน่นเกินของจริง ควรปรับเกณฑ์ (villages.usage_spike_ratio) ' +
      'ไม่ใช่ปล่อยให้คนกดผ่านต่อไป เพราะนิสัยกดผ่านจะลามไปถึงใบที่ผิดจริง',
  })
  async flagSummary(@Query('days') days?: string) {
    return await this.readingFlagsService.summary(days ? +days : 30);
  }

  @Get('housekeeping')
  @ApiOperation({
    summary: 'มีอะไรรอเก็บกวาดอยู่บ้าง (นับอย่างเดียว ไม่ลบอะไร)',
  })
  async housekeeping() {
    return await this.housekeepingService.status();
  }

  @Post('housekeeping/run')
  @ApiOperation({
    summary: 'สั่งเก็บกวาดเดี๋ยวนี้ โดยไม่ต้องรอ cron',
    description:
      'ทำสี่อย่างเหมือนที่ cron ทำ: ดีดบิลเลยกำหนด, ลบรูปของบิลที่จ่ายแล้วเกิน 1 ปี, ' +
      'ตีทิ้งข้อมูลกำพร้าที่ค้างเกิน 90 วัน และลบไฟล์รูปที่ไม่มีใครอ้างถึง\n\n' +
      '⚠️ การลบไฟล์รูปกู้คืนไม่ได้ — ดู GET /audit/housekeeping ก่อนว่าจะหายอะไรไปบ้าง',
  })
  async runHousekeeping() {
    return {
      overdue_marked: await this.housekeepingService.markOverdueBills(),
      photos_purged: await this.housekeepingService.purgeExpiredPhotos(),
      unassigned_discarded:
        await this.housekeepingService.discardStaleUnassigned(),
      orphan_files_removed:
        await this.housekeepingService.removeOrphanPhotoFiles(),
    };
  }
}
