import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MemberPortalService } from 'src/service/member-portal.service';
import { ReportsService } from 'src/service/reports.service';
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
  constructor(
    private readonly memberPortalService: MemberPortalService,
    private readonly reportsService: ReportsService,
  ) {}

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

  // ==========================================
  // เรื่องที่แจ้ง — ฝั่งแอดมินอยู่ที่ ReportsController → /reports
  // ==========================================

  @Get('reports')
  @ApiOperation({ summary: 'เรื่องที่บ้านของตัวเองแจ้งไว้ (ใหม่สุดก่อน)' })
  async getMyReports(@CurrentUser() user: JwtPayload) {
    const memberIds = await this.memberPortalService.getLinkedMemberIds(
      user.sub,
    );
    return await this.reportsService.findAllForMembers(memberIds);
  }

  @Post('reports')
  @ApiOperation({ summary: 'แจ้งเรื่องใหม่ถึงผู้ดูแลหมู่บ้าน' })
  async createMyReport(
    @CurrentUser() user: JwtPayload,
    @Body() createReportDto: CreateReportDto,
  ) {
    // ส่งรายการบ้านที่บัญชีนี้ดูแลเข้าไปให้ service เทียบกับ members_id ที่ส่งมา
    // ถ้าไม่ส่งไป ลูกบ้านจะยิง members_id ของบ้านคนอื่นมาแจ้งแทนได้
    const allowedMemberIds = await this.memberPortalService.getLinkedMemberIds(
      user.sub,
    );
    return await this.reportsService.create(
      user.sub,
      createReportDto,
      allowedMemberIds,
    );
  }
}
