import { Controller, Get, Post, Body, Param, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MeterReadingsService } from '../service/meter-readings.service';
import 'multer';
import { CreateMeterReadingDto } from '../dto/create-meter-reading.dto'; // เช็ค Path ให้ตรงด้วยนะครับ

@ApiTags('Meter Readings (การจดมิเตอร์น้ำ)')
@Controller('meter-readings')
export class MeterReadingsController {
  constructor(private readonly meterReadingsService: MeterReadingsService) {}

  @Post()
  @ApiOperation({ summary: 'บันทึกการจดมิเตอร์น้ำประจำเดือนลงฐานข้อมูล' })
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

  // --- Endpoint สำหรับรับอัปโหลดรูปภาพ ---
  @Post('ocr-upload')
  @ApiOperation({ summary: 'อัปโหลดรูปมิเตอร์เพื่อให้อ่านตัวเลขอัตโนมัติ (AI)' })
  @ApiConsumes('multipart/form-data') // บอก Swagger ว่ารับข้อมูลแบบอัปโหลดไฟล์
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'ไฟล์รูปถ่ายมิเตอร์น้ำ (.jpg, .png)',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file')) // รับไฟล์จาก Key ที่ชื่อว่า 'file'
  async uploadForOcr(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('กรุณาแนบไฟล์รูปภาพมาด้วย');
    }

    // โยน Buffer ของไฟล์ที่ได้รับ ไปให้ Service จัดการ
    return await this.meterReadingsService.extractMeterUnit(file.buffer);
  }
}