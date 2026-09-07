import { imageUploadOptions, validateImage } from '../security/upload';
import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import 'multer';
import { BillsService } from 'src/service/bills.service';
import { ScanBatchService } from 'src/service/scan-batch.service';
import { CreateBillDto } from 'src/dto/create-bill.dto';
import { CreateBillFromScanDto } from 'src/dto/create-bill-from-scan.dto';
import { ScanBatchDto } from 'src/dto/scan-batch.dto';
import { UpdateReadingDto } from 'src/dto/update-reading.dto';
import { Roles } from 'src/auth/roles.decorator';
import { CurrentUser } from 'src/auth/current-user.decorator';
// ต้องเป็น `import type` เพราะ tsconfig เปิด isolatedModules + emitDecoratorMetadata ไว้
import type { JwtPayload } from 'src/auth/auth.constants';

@ApiTags('Bills (บิลเรียกเก็บค่าน้ำ)')
// 🔐 ทั้ง controller นี้เป็นงานฝั่งผู้ดูแลหมู่บ้าน — ต้องล็อกอินเป็น admin เท่านั้น
//    เมื่อเปิดระบบล็อกอินลูกบ้านแล้ว ค่อยแยก route ที่ลูกบ้านดูได้ออกมาทีหลัง
@Roles('admin')
@ApiBearerAuth()
@Controller('bills')
export class BillsController {
  constructor(
    private readonly billsService: BillsService,
    private readonly scanBatchService: ScanBatchService,
  ) {}

  /**
   * 🌟 create_by มาจาก token ไม่ใช่จาก body
   *
   *   1. `bills.create_by` / `meter_readings.create_by` เป็น NOT NULL แต่ DTO ประกาศเป็น
   *      optional — client ที่ไม่ส่งมาเคยได้ 500 ที่อ่านไม่รู้เรื่องจาก MySQL
   *   2. หน้าเว็บส่ง 1 มาตายตัว บิลทุกใบจึงถูกจดว่าแอดมิน id 1 เป็นคนออก
   *      ไม่ว่าใครล็อกอินอยู่ — ร่องรอย "ใครออกบิลใบนี้" ใช้ตอบอะไรไม่ได้เลย
   *   3. ค่าจาก body ผู้ใช้แก้เองได้ (ดู current-user.decorator.ts)
   *
   * ค่าใน body ถูกทับทิ้งเสมอ เก็บฟิลด์ไว้ใน DTO เฉย ๆ กัน client เก่าพัง
   */
  @Post()
  @ApiOperation({ summary: 'สร้างบิลค่าน้ำใหม่ (ระบบจะคำนวณยอดให้อัตโนมัติ)' })
  async create(
    @Body() createBillDto: CreateBillDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.billsService.create({
      ...createBillDto,
      create_by: user.sub,
    });
  }

  @Post('scan')
  @ApiOperation({
    summary:
      'จดมิเตอร์ + ออกบิล ในคำสั่งเดียว (ตรวจให้ผ่านก่อนค่อยเขียน ทั้งคู่อยู่ในทรานแซกชันเดียว)',
  })
  async createFromScan(
    @Body() dto: CreateBillFromScanDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // create_by มาจาก token ด้วยเหตุผลเดียวกับ POST /bills ข้างบน
    return await this.billsService.createFromScan({
      ...dto,
      create_by: user.sub,
    });
  }

  @Post('scan-batch')
  @ApiOperation({
    summary:
      'อัปรูปมิเตอร์หลายใบพร้อมกัน แล้วให้ระบบเดาว่ารูปไหนเป็นของบ้านหลังไหน (ไม่เขียนฐานข้อมูล)',
    description:
      'จับคู่จาก "เลขมิเตอร์" ไม่ใช่ GPS — เลขมิเตอร์เป็นยอดสะสมที่แต่ละบ้านห่างกันมาก ' +
      'จึงชี้กลับไปหาบ้านต้นทางได้เอง โดยตัดบ้านที่ทำให้หน่วยน้ำติดลบทิ้ง ' +
      'แล้วให้คะแนนตามว่าหน่วยที่ใช้ใกล้เคียงกับที่บ้านนั้นเคยใช้แค่ไหน\n\n' +
      '⚠️ คืนแค่ข้อเสนอ ยังไม่ออกบิล — เมื่อคนตรวจยืนยันแล้วให้ยิง POST /bills/scan ทีละหลัง ' +
      'เพราะด่านกันข้อมูลผิดทั้งหมดอยู่ที่นั่น',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files', 'billing_month', 'billing_year'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: `รูปมิเตอร์หลายใบ (สูงสุด ${ScanBatchService.MAX_FILES} รูปต่อครั้ง)`,
        },
        billing_month: { type: 'string', example: '08' },
        billing_year: { type: 'string', example: '2026' },
        villages_id: { type: 'number', example: 1 },
        photo_meta: {
          type: 'string',
          description:
            'JSON array ของวันถ่าย/พิกัดที่อ่านจากไฟล์ต้นฉบับก่อนย่อรูป เรียงตรงลำดับกับ files',
        },
      },
    },
  })
  @UseInterceptors(
    FilesInterceptor('files', ScanBatchService.MAX_FILES, imageUploadOptions),
  )
  async scanBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ScanBatchDto,
  ) {
    for (const file of files ?? []) await validateImage(file);
    return await this.scanBatchService.analyze(files, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบบิลค่าน้ำตาม ID' })
  async remove(@Param('id') id: string) {
    return await this.billsService.remove(+id);
  }

  // ⚠️ ต้องอยู่ก่อน @Get(':id') ไม่งั้น 'outstanding' จะถูกจับเป็น id แล้วคิวรีเพี้ยน
  @Get('outstanding')
  @ApiOperation({
    summary: 'ยอดค้างชำระสะสมรายบ้าน (เรียงบ้านที่ค้างหนักสุดขึ้นก่อน)',
    description:
      'รวมบิลที่ยังไม่จ่ายทุกใบของแต่ละบ้านเป็นยอดเดียว พร้อมจำนวนใบและวันครบกำหนดที่เก่าที่สุด\n\n' +
      'เรียกแล้วจะดีดบิลที่เลยกำหนดเป็น Overdue ให้อัตโนมัติก่อนคิดยอด — ' +
      'ไม่ต้องมีใครไปกดเปลี่ยนสถานะเองอีก',
  })
  async outstanding(@Query('villages_id') villagesId?: string) {
    return await this.billsService.outstandingByMember(
      villagesId ? +villagesId : undefined,
    );
  }

  @Get('missing')
  @ApiOperation({
    summary: 'บ้านที่ยังไม่มีบิลของเดือนที่ระบุ (เดินจดตกบ้านไหนไปบ้าง)',
    description:
      'ถ้าไม่ไล่ดูตั้งแต่ยังอยู่ในเดือนนั้น เดือนที่ข้ามไปจะไปโผล่เป็นบิลสองเดือน' +
      'รวมกันในเดือนถัดไป ซึ่งตอนนั้นย้อนกลับไปจดไม่ได้แล้ว\n\n' +
      '`months_since_last_bill` แยกบ้านที่แค่ยังไม่ได้จดรอบนี้ (= 1) ' +
      'ออกจากบ้านที่หายไปจากระบบหลายเดือนแล้ว',
  })
  async missing(
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('villages_id') villagesId?: string,
  ) {
    return await this.billsService.findMissingBills(
      month,
      year,
      villagesId ? +villagesId : undefined,
    );
  }

  // ⚠️ ต้องอยู่ก่อน @Get(':id') ไม่งั้น 'member' จะถูกจับเป็น id แล้วคิวรีเพี้ยน
  @Get('member/:membersId/month')
  @ApiOperation({
    summary:
      'เช็คว่าบ้านหลังนี้มีบิลของเดือน/ปีที่ระบุแล้วหรือยัง (null = ยังไม่มี)',
  })
  async findByMemberAndMonth(
    @Param('membersId') membersId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return await this.billsService.findByMemberAndMonth(
      +membersId,
      month,
      year,
    );
  }

  @Get('member/:membersId/previous')
  @ApiOperation({
    summary:
      'เลขตั้งต้นที่จะใช้คิดหน่วยน้ำของเดือนที่ระบุ (บิลเดือนก่อน → เลขตอนลงทะเบียน → 0)',
  })
  async getPreviousUnit(
    @Param('membersId') membersId: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return await this.billsService.getPreviousUnit(+membersId, month, year);
  }

  @Get()
  @ApiOperation({ summary: 'ดูประวัติบิลค่าน้ำ' })
  async findAll() {
    // 🌟 เช็คว่ามีคำว่า return คืนค่ากลับไปให้หน้าบ้านไหม
    return await this.billsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูบิลค่าน้ำตาม ID' })
  async findOne(@Param('id') id: string) {
    return await this.billsService.findOne(+id);
  }
  @Post(':id/pay')
  @ApiOperation({
    summary: 'รับชำระเงิน — ปิดใบเก่าที่ถูกทบยอดเข้ามาให้ด้วยทั้งชุด',
    description:
      'ลูกบ้านจ่ายตามยอด grand_total ซึ่งรวมยอดค้างของใบเก่าไปแล้ว\n\n' +
      '⚠️ อย่าใช้ PATCH /:id/status เพื่อรับเงินอีกต่อไป — ตัวนั้นปิดแค่ใบเดียว ' +
      'ใบเก่าที่ถูกทบจะยังค้างอยู่ แล้วบิลเดือนถัดไปจะทบยอดเดิมเข้าไปอีกรอบ ' +
      '(ลูกบ้านโดนเก็บซ้ำจากก้อนที่จ่ายไปแล้ว)\n\n' +
      'ตอบกลับมี settled_bill_ids บอกว่าปิดใบไหนไปพร้อมกันบ้าง',
  })
  async pay(@Param('id') id: string, @Body('paid_by') paidBy?: number) {
    return await this.billsService.payBill(+id, paidBy);
  }

  @Patch(':id/reading')
  @ApiOperation({
    summary: 'แก้เลขมิเตอร์ของบิลที่ออกไปแล้ว (คิดยอดใหม่ให้ทั้งสาย)',
    description:
      'ใช้ตอน OCR อ่านผิดแล้วบิลออกไปแล้ว — แก้เฉพาะตัวเลข โดยคงหลักฐานการเดินไปจด ' +
      '(พิกัด/เวลาถ่าย) ของครั้งนั้นไว้ทั้งหมด ต่างจากการ "จดทับ" ที่ลบใบเดิมทิ้งแล้วสร้างใหม่\n\n' +
      '**สิทธิ์:** owner แก้ได้ตลอด / staff แก้ได้เฉพาะใบที่จดวันนี้ หรือใบที่ยังเป็น "รอชำระเงิน"\n\n' +
      '⚠️ บิลที่ชำระเงินแล้วแก้ไม่ได้แม้จะเป็น owner — ต้องกดปรับสถานะกลับเป็นรอชำระก่อน\n\n' +
      '⚠️ `reason` บังคับกรอกเสมอ (เก็บลง meter_reading_logs — ดู GET /audit/reading-logs)\n\n' +
      'ติดด่านจะได้ **400** พร้อม `code: "high_usage" | "meter_reset"` ให้หน้าเว็บเปิดปุ่มยืนยัน ' +
      'แล้วยิงซ้ำพร้อม `confirm_high_usage` / `confirm_meter_reset` — error ที่ไม่มี `code` ' +
      'คือ error ธรรมดา ห้ามขึ้นปุ่มยืนยันให้กดข้าม\n\n' +
      'แก้สำเร็จแล้วให้โหลดประวัติบิลใหม่ทั้งชุด เพราะยอดค้างที่ใบอื่นทบใบนี้ไว้เปลี่ยนตามไปด้วย',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('photo', imageUploadOptions))
  async updateReading(
    @Param('id') id: string,
    @Body() dto: UpdateReadingDto,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    if (photo) await validateImage(photo);
    return await this.billsService.updateReading(
      +id,
      {
        current_unit: dto.current_unit,
        reason: dto.reason,
        // MeterPhotoService รับ data URL เท่านั้น (ผ่าน sharp เองเพื่อกันไฟล์ที่ไม่ใช่รูป
        // ถูกวางไว้ในโฟลเดอร์ที่เสิร์ฟเป็น static) — แปลงจากไฟล์ที่อัปมาให้ตรงรูปแบบนั้น
        photo: photo ? BillsController.toDataUrl(photo) : null,
        confirm_high_usage: dto.confirm_high_usage,
        confirm_meter_reset: dto.confirm_meter_reset,
      },
      {
        // ⚠️ ต้องมาจาก token ที่เซิร์ฟเวอร์เซ็นเองเท่านั้น ห้ามรับจาก body เด็ดขาด
        //    ไม่งั้นใครก็ยิง admin_role: 'owner' มาเองได้
        id: user?.sub ?? null,
        // token ที่ออกก่อน migrate-admin-role.sql ไม่มีฟิลด์นี้ — ถือเป็น staff เสมอ
        admin_role: user?.admin_role ?? 'staff',
      },
    );
  }

  /** ไฟล์ที่อัปมา → data URL ที่ MeterPhotoService รับได้ */
  private static toDataUrl(file: Express.Multer.File): string {
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException(
        'ไฟล์ที่แนบมาไม่ใช่รูปภาพครับ กรุณาแนบรูปหน้าปัดมิเตอร์',
      );
    }
    return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  }

  // 🌟 เพิ่มฟังก์ชันนี้สำหรับรับค่าการอัปเดตสถานะ
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('payment_status') status: string,
  ) {
    // โยนภาระไปให้ billsService จัดการอัปเดต Database
    return await this.billsService.updateStatus(+id, status);
  }
}
