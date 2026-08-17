import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MetersService } from 'src/service/meters.service';
import { RegisterMeterDto, ReplaceMeterDto } from 'src/dto/meter.dto';
import { Roles } from 'src/auth/roles.decorator';

@ApiTags('Meters (ทะเบียนมิเตอร์)')
@Roles('admin')
@ApiBearerAuth()
@Controller('meters')
export class MetersController {
  constructor(private readonly metersService: MetersService) {}

  @Get('member/:membersId')
  @ApiOperation({
    summary: 'ประวัติมิเตอร์ทุกตัวของบ้านหลังนี้ (ใหม่สุดขึ้นก่อน)',
    description:
      'ตัวที่ removed_at เป็น null คือตัวที่ใช้อยู่ปัจจุบัน — ' +
      'ตัวที่ residual_billed_at เป็น null คือตัวที่หน่วยค้างยังรอคิดเข้าบิลใบถัดไป',
  })
  async findByMember(@Param('membersId') membersId: string) {
    return await this.metersService.findByMember(+membersId);
  }

  @Post('register')
  @ApiOperation({
    summary:
      'ลงทะเบียนมิเตอร์ตัวปัจจุบันของบ้าน (บ้านที่เข้าระบบก่อนมีทะเบียน)',
    description:
      'ไม่ไปยุ่งกับเลขตั้งต้นของบิล — ตารางนี้เก็บ "ตัวตนของมิเตอร์" ไม่ใช่ "เลขที่ใช้คิดเงิน"\n\n' +
      'กรอก digits ไว้ด้วยจะทำให้ด่านจับ OCR อ่านหลักหาย/เกิน ทำงานตั้งแต่บิลใบแรกของบ้านนี้',
  })
  async register(@Body() dto: RegisterMeterDto) {
    return await this.metersService.register(dto);
  }

  @Post('replace')
  @ApiOperation({
    summary:
      'เปลี่ยนมิเตอร์ใหม่ — ปิดทะเบียนตัวเก่าและเปิดตัวใหม่ในทรานแซกชันเดียว',
    description:
      '⚠️ ต้องบันทึก **ตอนเปลี่ยน** ไม่ใช่รอไปกรอกตอนออกบิล เพราะคนที่เปลี่ยนมิเตอร์ ' +
      '(ช่าง) กับคนที่เดินจดรอบถัดไปมักคนละคนและห่างกันเป็นสัปดาห์ — ' +
      'คนจดไม่มีทางรู้เลขปิดของตัวที่ถอดไปแล้ว\n\n' +
      'หน่วยที่ใช้บนตัวเก่าก่อนถอดจะถูกบวกเข้าบิลใบถัดไปให้อัตโนมัติ แล้วมาร์กว่าคิดแล้ว ' +
      'ไม่คิดซ้ำอีก (ตอบกลับมี residual_unit บอกว่าจะบวกกี่หน่วย)',
  })
  async replace(@Body() dto: ReplaceMeterDto) {
    return await this.metersService.replace(dto);
  }
}
