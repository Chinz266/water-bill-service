import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from 'src/service/auth.service';
import { AuthRegisterDto } from 'src/dto/auth-register.dto';
import { AuthLoginDto } from 'src/dto/auth-login.dto';
import { MemberAuthDto } from 'src/dto/member-auth.dto';
import { Public } from 'src/auth/public.decorator';
import { CurrentUser } from 'src/auth/current-user.decorator';
// ต้องเป็น `import type` เพราะ tsconfig เปิด isolatedModules + emitDecoratorMetadata ไว้
import type { JwtPayload } from 'src/auth/auth.constants';

@ApiTags('Auth (เข้าสู่ระบบ / สมัครสมาชิก)')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Public()
    @Post('register')
    @ApiOperation({ summary: 'สมัครสมาชิกใหม่' })
    register(@Body() data: AuthRegisterDto) {
        return this.authService.register(data);
    }

    @Public()
    @Post('login')
    @ApiOperation({ summary: 'เข้าสู่ระบบ (คืน access_token ไว้แนบกับ request ถัดไป)' })
    login(@Body() data: AuthLoginDto) {
        return this.authService.login(data);
    }

    @Public()
    @Post('google')
    @ApiOperation({ summary: 'เข้าสู่ระบบด้วย Google (ยังไม่เปิดใช้งาน)' })
    google() {
        return this.authService.loginWithGoogle();
    }

    // สมัครสมาชิกลูกบ้าน — ต้องมีบ้านที่ลงทะเบียนเบอร์นี้ไว้แล้วในระบบเท่านั้น
    @Public()
    @Post('member/register')
    @ApiOperation({ summary: 'สมัครบัญชีลูกบ้าน (ล็อกอินด้วยเบอร์โทร)' })
    registerMember(@Body() data: MemberAuthDto) {
        return this.authService.registerMember(data);
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
