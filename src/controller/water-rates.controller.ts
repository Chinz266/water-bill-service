import { Controller, Get, Post, Body } from '@nestjs/common';
import { CreateWaterRateDto } from 'src/dto/create-water-rate.dto';
import { WaterRatesService } from 'src/service/water-rates.service';
import { Roles } from 'src/auth/roles.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';

// 🔐 ทั้ง controller นี้เป็นงานฝั่งผู้ดูแลหมู่บ้าน — ต้องล็อกอินเป็น admin เท่านั้น
//    เมื่อเปิดระบบล็อกอินลูกบ้านแล้ว ค่อยแยก route ที่ลูกบ้านดูได้ออกมาทีหลัง
@Roles('admin')
@ApiBearerAuth()
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

  // ประวัติเรทค่าน้ำทั้งหมด — ใช้ในหน้าตั้งค่าเรทค่าน้ำ
  @Get()
  async findAll() {
    return await this.waterRatesService.findAll();
  }
}