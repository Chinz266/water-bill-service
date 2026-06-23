import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CreateMeterReadingDto } from 'src/dto/create-meter-reading.dto';
import { MeterReadingsService } from 'src/service/meter-readings.service';

@ApiTags('Meter Readings (การจดมิเตอร์น้ำ)')
@Controller('meter-readings')
export class MeterReadingsController {
  constructor(private readonly meterReadingsService: MeterReadingsService) {}

  @Post()
  @ApiOperation({ summary: 'บันทึกการจดมิเตอร์น้ำประจำเดือน' })
  async create(@Body() createMeterReadingDto: CreateMeterReadingDto) {
    return await this.meterReadingsService.create(createMeterReadingDto);
  }

  @Get()
  @ApiOperation({ summary: 'ดูประวัติการจดมิเตอร์ทั้งหมด' })
  async findAll() {
    return await this.meterReadingsService.findAll();
  }

  @Get('member/:memberId')
  @ApiOperation({ summary: 'ดูประวัติการจดมิเตอร์แยกตาม ID ลูกบ้าน' })
  async findByMember(@Param('memberId') memberId: string) {
    return await this.meterReadingsService.findByMember(+memberId);
  }
}