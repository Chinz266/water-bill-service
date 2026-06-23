import { Controller, Get, Post, Body } from '@nestjs/common';
import { CreateWaterRateDto } from 'src/dto/create-water-rate.dto';
import { WaterRatesService } from 'src/service/water-rates.service';

@Controller('water-rates')
export class WaterRatesController {
  constructor(private readonly waterRatesService: WaterRatesService) {}

  // รับ POST Request ที่ /water-rates
  @Post()
  async create(@Body() createWaterRateDto: CreateWaterRateDto) {
    // ใช้ Validator หรือ Pipe ตรวจสอบข้อมูลก่อนได้ (ถ้ามี)
    return await this.waterRatesService.create(createWaterRateDto);
  }

  // รับ GET Request ที่ /water-rates/active
  @Get('active')
  async findActive() {
    return await this.waterRatesService.findActive();
  }
}