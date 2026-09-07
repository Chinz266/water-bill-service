import { Body, Controller, Post } from '@nestjs/common';
import { MemberService } from 'src/service/member.service';
import { UpdateInitialReadingDto } from 'src/dto/update-initial-reading.dto';
import { MemberRemoveDto } from 'src/dto/member-remove.dto';
import { CreateMemberDto } from 'src/dto/member-create.dto';
import { RegisterMemberOnsiteDto } from 'src/dto/member-onsite.dto';
import { Roles } from 'src/auth/roles.decorator';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

// 🔐 ทั้ง controller นี้เป็นงานฝั่งผู้ดูแลหมู่บ้าน — ต้องล็อกอินเป็น admin เท่านั้น
//    เมื่อเปิดระบบล็อกอินลูกบ้านแล้ว ค่อยแยก route ที่ลูกบ้านดูได้ออกมาทีหลัง
@Roles('admin')
@ApiBearerAuth()
@Controller('member')
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Post('/all')
  findAll() {
    return this.memberService.findAll();
  }

  @Post('/find-one')
  findOne(@Body() userData: MemberRemoveDto) {
    return this.memberService.findOne(userData.id);
  }

  @Post('/create')
  @ApiOperation({
    summary: 'ลงทะเบียนลูกบ้านแบบกรอกฟอร์ม (แบบเดิม)',
    description:
      '⚠️ ไม่บันทึกเลขมิเตอร์ตั้งต้น และพิกัดเป็น optional — บ้านที่สร้างด้วยวิธีนี้ ' +
      'จะคิดบิลใบแรกจาก 0 และระบบจับคู่รูปกับบ้านหลังนี้ไม่ได้ ' +
      'แนะนำให้ใช้ /member/register-onsite แทน',
  })
  create(@Body() userData: CreateMemberDto) {
    return this.memberService.create(userData);
  }

  @Post('/register-onsite')
  @ApiOperation({
    summary: 'ลงทะเบียนลูกบ้านโดยไปยืนที่มิเตอร์ (แนะนำให้ใช้ตัวนี้)',
    description:
      'บันทึกพิกัด ณ จุดที่ยืนอยู่หน้ามิเตอร์ + เลขมิเตอร์ตั้งต้น + รูปหลักฐาน ในคำสั่งเดียว\n\n' +
      'พิกัดต้องมาจาก navigator.geolocation ตอนยืนอยู่จริง ไม่ใช่จิ้มหมุดบนแผนที่ — ' +
      'เพราะตอนจดมิเตอร์ทุกเดือนพนักงานก็ยืนที่จุดเดียวกันนี้ ' +
      'พิกัดสองฝั่งจึงมาจากเซนเซอร์เดียวกันและเทียบกันได้จริง\n\n' +
      'สร้างทั้งบ้านและการจดครั้งแรกในทรานแซกชันเดียว ' +
      'การจดครั้งแรกนี้จะกลายเป็นเลขตั้งต้นของบิลใบแรกโดยอัตโนมัติ',
  })
  registerOnsite(@Body() dto: RegisterMemberOnsiteDto) {
    return this.memberService.registerOnsite(dto);
  }

  @Post('/update')
  update(@Body() userData: CreateMemberDto) {
    return this.memberService.update(userData);
  }

  @Post('/initial-reading')
  @ApiOperation({
    summary: 'แก้เลขมิเตอร์ตั้งต้นของบ้านที่ลงทะเบียนไปแล้ว',
    description:
      'เลขตั้งต้นคือเส้นเริ่มต้นที่บิลใบแรกเอาไปลบ พิมพ์ผิดหลักเดียวทุกบิลของบ้านหลังนั้นผิดตามไปหมด\n\n' +
      '- ต้องกรอกเหตุผลเสมอ เก็บลง meter_reading_logs (bills_id เป็น NULL เพราะยังไม่มีบิล)\n' +
      '- เลขใหม่ต้องไม่มากกว่าการจดครั้งถัดไป — มิเตอร์ไม่เดินถอยหลัง\n' +
      '- **ไม่คิดยอดบิลที่ออกไปแล้วใหม่ให้** ต้องไปแก้ทีละใบผ่าน PATCH /bills/:id/reading เอง',
  })
  updateInitialReading(@Body() dto: UpdateInitialReadingDto) {
    return this.memberService.updateInitialReading(dto);
  }

  @Post('/remove')
  remove(@Body() userData: MemberRemoveDto) {
    return this.memberService.remove(userData);
  }
}
