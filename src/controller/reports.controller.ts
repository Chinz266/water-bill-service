import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from 'src/service/reports.service';
import { ReplyReportDto } from 'src/dto/reply-report.dto';
import { Roles } from 'src/auth/roles.decorator';
import { CurrentUser } from 'src/auth/current-user.decorator';
import type { JwtPayload } from 'src/auth/auth.constants';

/**
 * 🔐 ฝั่งผู้ดูแลหมู่บ้าน — เห็นเรื่องที่ลูกบ้านแจ้งเข้ามาทุกหลัง
 *    ฝั่งลูกบ้าน (เห็นเฉพาะบ้านตัวเอง) อยู่ที่ MemberPortalController → /me/reports
 */
@ApiTags('Reports (เรื่องที่ลูกบ้านแจ้ง)')
@Roles('admin')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'ดูเรื่องที่ลูกบ้านแจ้งทั้งหมด (ใหม่สุดก่อน)' })
  async findAll() {
    return await this.reportsService.findAll();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'ตอบกลับ และ/หรือ เปลี่ยนสถานะเรื่อง (ส่งมาแค่อย่างใดอย่างหนึ่งก็ได้)',
  })
  async reply(
    // ParseIntPipe กัน id ที่ไม่ใช่ตัวเลข ไม่ให้หลุดไปเป็น NaN แล้วคิวรีเพี้ยน
    @Param('id', ParseIntPipe) id: number,
    @Body() replyReportDto: ReplyReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // ส่ง id ของแอดมินที่ล็อกอินอยู่ไปบันทึกเป็น replied_by (ไม่รับจาก body)
    return await this.reportsService.reply(id, replyReportDto, user.sub);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ลบเรื่องทิ้ง (เช่น เรื่องที่แจ้งซ้ำ)' })
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.reportsService.remove(id);
  }
}
