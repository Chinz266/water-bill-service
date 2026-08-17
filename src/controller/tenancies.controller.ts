import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenancyService } from 'src/service/tenancy.service';
import { MoveOutDto, StartTenancyDto } from 'src/dto/tenancy.dto';
import { Roles } from 'src/auth/roles.decorator';

@ApiTags('Tenancies (ผู้อยู่อาศัย / ย้ายเข้า-ย้ายออก)')
@Roles('admin')
@ApiBearerAuth()
@Controller('tenancies')
export class TenanciesController {
  constructor(private readonly tenancyService: TenancyService) {}

  @Get('member/:membersId')
  @ApiOperation({
    summary: 'ประวัติผู้อยู่อาศัยของบ้านหลังนี้ (ใหม่สุดขึ้นก่อน)',
    description: 'แถวที่ end_date เป็น null คือคนที่อยู่ปัจจุบัน',
  })
  async findByMember(@Param('membersId') membersId: string) {
    return await this.tenancyService.findByMember(+membersId);
  }

  @Post('start')
  @ApiOperation({
    summary: 'เริ่มสัญญาของผู้อยู่อาศัยรายใหม่ (ปิดรายเดิมให้อัตโนมัติ)',
    description:
      'ปิดรายเดิมด้วยวันก่อนหน้าวันที่คนใหม่เข้าอยู่ — ห้ามให้ช่วงเวลาซ้อนกัน ' +
      'ไม่งั้นบิลใบหนึ่งจะตอบไม่ได้ว่าเรียกเก็บจากใครในสองคนนั้น',
  })
  async start(@Body() dto: StartTenancyDto) {
    return await this.tenancyService.start(dto);
  }

  @Post('move-out')
  @ApiOperation({
    summary: 'ย้ายออก — จดมิเตอร์ครั้งสุดท้าย ออกบิลปิดยอด แล้วปิดสัญญา',
    description:
      'บิลที่ได้ต่างจากบิลประจำเดือนสองอย่าง:\n' +
      '1. due_date = วันย้ายออกเลย ไม่ยืดตามรอบชำระของหมู่บ้าน (ย้ายไปแล้วตามเก็บไม่ได้)\n' +
      '2. ทบยอดค้างเก่าทั้งหมดเข้าใบนี้ เพราะเป็นใบสุดท้ายที่เรียกเก็บจากคนนี้ได้ — ' +
      'ถ้าไม่ทบ ยอดจะตกไปอยู่กับผู้เช่าคนถัดไปที่ไม่ได้ใช้น้ำก้อนนั้นเลย\n\n' +
      'ผู้เช่าคนใหม่ไม่ต้องตั้งเลขตั้งต้นเอง — getPreviousUnit() หยิบเลขปิดของบิลใบนี้ให้อยู่แล้ว\n\n' +
      'ด่านกันข้อมูลผิดทุกด่านของ POST /bills/scan ยังทำงานครบเหมือนเดิม',
  })
  async moveOut(@Body() dto: MoveOutDto) {
    return await this.tenancyService.moveOut(dto);
  }
}
