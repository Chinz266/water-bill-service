import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from 'src/service/auth.service';
import { AuthRegisterDto } from 'src/dto/auth-register.dto';
import { AuthLoginDto } from 'src/dto/auth-login.dto';
import { MemberAuthDto } from 'src/dto/member-auth.dto';
import { Public } from 'src/auth/public.decorator';
import { Roles } from 'src/auth/roles.decorator';
import { CurrentUser } from 'src/auth/current-user.decorator';
// ต้องเป็น `import type` เพราะ tsconfig เปิด isolatedModules + emitDecoratorMetadata ไว้
import type { JwtPayload } from 'src/auth/auth.constants';

@ApiTags('Auth (เข้าสู่ระบบ / สมัครสมาชิก)')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * ⚠️ เคยเป็น @Public() — ใครก็ตามที่ยิง request เข้ามาได้จะเปิดบัญชี role='admin'
   *    ให้ตัวเองแล้วเข้าหลังบ้านได้ทันที (เห็นทะเบียนลูกบ้านทั้งหมด ออกบิล ลบบิล)
   *    ที่กันไว้มีแค่ admin_role ที่ default เป็น staff ซึ่งกันได้แค่การแก้บิลย้อนหลัง
   *
   * ตอนนี้เป็น "แอดมินที่ล็อกอินอยู่เปิดบัญชีให้คนใหม่" — ไม่ใช่ "ใครก็สมัครเองได้"
   * (ใช้แทน POST /admin/create ไม่ได้ เพราะ AdminCreateDto ไม่มีช่องอีเมล
   *  ซึ่งเป็น username ของฝั่งผู้ดูแล บัญชีที่สร้างจากที่นั่นจึงล็อกอินไม่ได้)
   */
  @Roles('admin')
  @ApiBearerAuth()
  @Post('register')
  @ApiOperation({ summary: 'เปิดบัญชีผู้ดูแลใหม่ (ต้องล็อกอินเป็นแอดมินก่อน)' })
  register(@Body() data: AuthRegisterDto) {
    return this.authService.register(data);
  }

  @Public()
  @Post('login')
  @ApiOperation({
    summary: 'เข้าสู่ระบบ (คืน access_token ไว้แนบกับ request ถัดไป)',
  })
  login(@Body() data: AuthLoginDto) {
    return this.authService.login(data);
  }

  @Public()
  @Post('member/login')
  @ApiOperation({ summary: 'เข้าสู่ระบบลูกบ้านด้วยเบอร์โทร' })
  loginMember(@Body() data: MemberAuthDto) {
    return this.authService.loginMember(data);
  }

  // ใช้ให้หน้าบ้านเช็คว่า token ที่เก็บไว้ยังใช้ได้ไหม และรู้ว่าตอนนี้ล็อกอินเป็นใคร/role อะไร
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'ดูข้อมูลผู้ใช้ที่ล็อกอินอยู่' })
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
