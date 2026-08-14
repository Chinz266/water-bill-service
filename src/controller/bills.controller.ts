import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BillsService } from 'src/service/bills.service';
import { CreateBillDto } from 'src/dto/create-bill.dto';
import { CreateBillFromScanDto } from 'src/dto/create-bill-from-scan.dto';
import { Roles } from 'src/auth/roles.decorator';

@ApiTags('Bills (บิลเรียกเก็บค่าน้ำ)')
// 🔐 ทั้ง controller นี้เป็นงานฝั่งผู้ดูแลหมู่บ้าน — ต้องล็อกอินเป็น admin เท่านั้น
//    เมื่อเปิดระบบล็อกอินลูกบ้านแล้ว ค่อยแยก route ที่ลูกบ้านดูได้ออกมาทีหลัง
@Roles('admin')
@ApiBearerAuth()
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

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

  @Delete(':id')
  @ApiOperation({ summary: 'ลบบิลค่าน้ำตาม ID' })
  async remove(@Param('id') id: string) {
    return await this.billsService.remove(+id);
  }

  // ⚠️ ต้องอยู่ก่อน @Get(':id') ไม่งั้น 'member' จะถูกจับเป็น id แล้วคิวรีเพี้ยน
  @Get('member/:membersId/month')
  @ApiOperation({
    summary: 'เช็คว่าบ้านหลังนี้มีบิลของเดือน/ปีที่ระบุแล้วหรือยัง (null = ยังไม่มี)',
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
