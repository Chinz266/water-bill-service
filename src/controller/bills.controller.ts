import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
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
import { Roles } from 'src/auth/roles.decorator';

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

  @Post()
  @ApiOperation({ summary: 'สร้างบิลค่าน้ำใหม่ (ระบบจะคำนวณยอดให้อัตโนมัติ)' })
  async create(@Body() createBillDto: CreateBillDto) {
    return await this.billsService.create(createBillDto);
  }

  @Post('scan')
  @ApiOperation({
    summary:
      'จดมิเตอร์ + ออกบิล ในคำสั่งเดียว (ตรวจให้ผ่านก่อนค่อยเขียน ทั้งคู่อยู่ในทรานแซกชันเดียว)',
  })
  async createFromScan(@Body() dto: CreateBillFromScanDto) {
    return await this.billsService.createFromScan(dto);
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
          description: 'รูปมิเตอร์หลายใบ (สูงสุด 30 รูปต่อครั้ง)',
        },
        billing_month: { type: 'string', example: '08' },
        billing_year: { type: 'string', example: '2026' },
        villages_id: { type: 'number', example: 1 },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', ScanBatchService.MAX_FILES))
  async scanBatch(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ScanBatchDto,
  ) {
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
