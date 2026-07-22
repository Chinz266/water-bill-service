import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MemberPortalService } from 'src/service/member-portal.service';
import { CreateReportDto } from 'src/dto/create-report.dto';
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

  @Get('admins')
  @ApiOperation({ summary: 'ข้อมูลผู้ดูแลไว้ติดต่อ (ชื่อ + เบอร์โทร)' })
  getAdminContacts() {
    return this.memberPortalService.getAdminContacts();
  }

  @Get('reports')
  @ApiOperation({
    summary: 'เรื่องที่แจ้งไว้ของบ้านตัวเอง พร้อมคำตอบจากผู้ดูแล',
  })
  getMyReports(@CurrentUser() user: JwtPayload) {
    return this.memberPortalService.getMyReports(user.sub);
  }

  @Post('reports')
  @ApiOperation({ summary: 'แจ้งเรื่องใหม่ไปหาผู้ดูแลหมู่บ้าน' })
  createMyReport(
    @CurrentUser() user: JwtPayload,
    @Body() createReportDto: CreateReportDto,
  ) {
    // account_id อ่านจาก token เสมอ ไม่รับจาก body (กันแจ้งแทนบัญชีคนอื่น)
    return this.memberPortalService.createMyReport(user.sub, createReportDto);
  }
}
