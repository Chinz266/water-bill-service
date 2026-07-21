import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MemberPortalService } from 'src/service/member-portal.service';
import { Roles } from 'src/auth/roles.decorator';
import { CurrentUser } from 'src/auth/current-user.decorator';
import type { JwtPayload } from 'src/auth/auth.constants';

/**
 * 🔐 พอร์ทัลลูกบ้าน — เห็นได้เฉพาะบ้านของตัวเองเท่านั้น
 *    ต่างจาก MemberController (ฝั่งแอดมิน) ที่เห็น/แก้ไขได้ทุกบ้าน
 *    บ้านที่เห็นมาจาก account_members เสมอ ไม่มีทางรับ memberId จาก client
 */
@ApiTags('Member Portal (พอร์ทัลลูกบ้าน)')
@Roles('member')
@ApiBearerAuth()
@Controller('me')
export class MemberPortalController {
  constructor(private readonly memberPortalService: MemberPortalService) {}

  @Get('houses')
  @ApiOperation({ summary: 'บ้านทั้งหมดที่บัญชีนี้ดูแล' })
  getMyHouses(@CurrentUser() user: JwtPayload) {
    return this.memberPortalService.getMyHouses(user.sub);
  }

  @Get('bills')
  @ApiOperation({
    summary: 'บิลของบ้านตัวเอง (ทุกหลังที่ดูแล) พร้อมสถานะการชำระเงิน',
  })
  getMyBills(@CurrentUser() user: JwtPayload) {
    return this.memberPortalService.getMyBills(user.sub);
  }
}
