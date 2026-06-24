import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BillsService } from 'src/service/bills.service';
import { CreateBillDto } from 'src/dto/create-bill.dto';
import { BillEntity } from '../entity/bill.entity';

@ApiTags('Bills (บิลเรียกเก็บค่าน้ำ)')
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Post()
  @ApiOperation({ summary: 'สร้างบิลค่าน้ำใหม่ (ระบบจะคำนวณยอดให้อัตโนมัติ)' })
  async create(@Body() createBillDto: CreateBillDto) {
    return await this.billsService.create(createBillDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบบิลค่าน้ำตาม ID' })
  async remove(@Param('id') id: string) {
    return await this.billsService.remove(+id);
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