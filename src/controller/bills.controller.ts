import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BillsService } from 'src/service/bills.service';
import { CreateBillDto } from 'src/dto/create-bill.dto';

@ApiTags('Bills (บิลเรียกเก็บค่าน้ำ)')
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Post()
  @ApiOperation({ summary: 'สร้างบิลค่าน้ำใหม่ (ระบบจะคำนวณยอดให้อัตโนมัติ)' })
  async create(@Body() createBillDto: CreateBillDto) {
    return await this.billsService.create(createBillDto);
  }

  @Get()
  @ApiOperation({ summary: 'ดูบิลค่าน้ำทั้งหมด' })
  async findAll() {
    return await this.billsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'ดูบิลค่าน้ำตาม ID' })
  async findOne(@Param('id') id: string) {
    return await this.billsService.findOne(+id);
  }
}