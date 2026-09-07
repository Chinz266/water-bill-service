import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UnassignedReadingsService } from 'src/service/unassigned-readings.service';
import {
  AssignUnassignedDto,
  CreateUnassignedReadingDto,
} from 'src/dto/unassigned-reading.dto';
import { Roles } from 'src/auth/roles.decorator';

@ApiTags('Unassigned Readings (ข้อมูลกำพร้า รอจับคู่บ้าน)')
@Roles('admin')
@ApiBearerAuth()
@Controller('readings/unassigned')
export class UnassignedReadingsController {
  constructor(private readonly service: UnassignedReadingsService) {}

  @Post()
  @ApiOperation({
    summary: 'ฝากรูปที่ยังไม่รู้ว่าของบ้านไหนไว้ในคิว',
    description:
      'ใช้เมื่อ OCR อ่านเลขไม่ออก หรือระบบเสนอหลายบ้านพอ ๆ กันจนคนหน้างานตัดสินไม่ได้\n\n' +
      'ดีกว่า "เดาแล้วกดไปก่อน" ซึ่งจบลงที่บิลผิดบ้าน และดีกว่าทิ้งรูปแล้วเดินกลับไปใหม่\n\n' +
      '⚠️ บังคับต้องแนบรูป — ไม่มีรูปก็ไม่เหลืออะไรให้คนมาตัดสินทีหลัง',
  })
  async create(@Body() dto: CreateUnassignedReadingDto) {
    return await this.service.create(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'คิวข้อมูลกำพร้า (เก่าสุดขึ้นก่อน)',
    description:
      'ของที่ค้างนานคือของที่ต้องรีบตัดสินใจก่อนข้ามเดือน — ข้ามเดือนแล้วจะไปชนด่าน ' +
      '"มีบิลใหม่กว่าอยู่" ทันที ไม่ส่ง status มาจะได้เฉพาะ Pending',
  })
  async findAll(
    @Query('status') status?: string,
    @Query('villages_id') villagesId?: string,
  ) {
    return await this.service.findAll({
      status,
      villages_id: villagesId ? +villagesId : undefined,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'ดูรูปหนึ่งใบพร้อมรายชื่อบ้านที่เป็นไปได้ 5 อันดับ',
    description:
      'ผู้สมัครคิดด้วยเกณฑ์ชุดเดียวกับหน้าอัปรูปทั้งชุด (ScanBatchService) ' +
      'ไม่ใช่สูตรใหม่ — ไม่งั้นจะเสนอบ้านที่พอกดยืนยันจริงแล้วโดนตีกลับเป็น 409\n\n' +
      'OCR อ่านไม่ออกตั้งแต่ต้น = candidates ว่าง ให้คนเปิดรูปดูแล้วพิมพ์เลขเอง',
  })
  async findOne(
    @Param('id') id: string,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return await this.service.findOneWithCandidates(+id, month, year);
  }

  @Post(':id/assign')
  @ApiOperation({
    summary: 'จับคู่กับบ้าน แล้วออกบิลผ่านเส้นทางปกติ',
    description:
      'วิ่งผ่าน POST /bills/scan ตัวเดิมทั้งหมด ด่านกันข้อมูลผิดจึงยังทำงานครบ — ' +
      'ปุ่ม confirm_* ทุกตัวจึงมีให้ใช้เหมือนกัน เผื่อโดนด่านไหนตีกลับ\n\n' +
      'ส่ง current_unit มาด้วยเมื่อ OCR อ่านไม่ออก (ถือเป็นการกรอกมือ ซึ่งมีรูปแนบอยู่แล้วโดยนิยาม)',
  })
  async assign(@Param('id') id: string, @Body() dto: AssignUnassignedDto) {
    return await this.service.assign(+id, dto);
  }

  @Post(':id/discard')
  @ApiOperation({
    summary: 'ตีทิ้ง — รูปที่เบลอจนอ่านไม่ออก หรือถ่ายผิดของ',
    description:
      'ลบไฟล์รูปทิ้งด้วย เพราะแถวที่ตีทิ้งแล้วไม่มีใครกลับมาเปิดดูอีก',
  })
  async discard(
    @Param('id') id: string,
    @Body('note') note?: string,
    @Body('resolved_by') resolvedBy?: number,
  ) {
    return await this.service.discard(+id, note, resolvedBy);
  }
}
