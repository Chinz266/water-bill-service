import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthService } from 'src/service/auth.service';
import { AuthRegisterDto } from 'src/dto/auth-register.dto';
import { AuthLoginDto } from 'src/dto/auth-login.dto';

@ApiTags('Auth (เข้าสู่ระบบ / สมัครสมาชิก)')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('register')
    @ApiOperation({ summary: 'สมัครสมาชิกใหม่' })
    register(@Body() data: AuthRegisterDto) {
        return this.authService.register(data);
    }

    @Post('login')
    @ApiOperation({ summary: 'เข้าสู่ระบบ' })
    login(@Body() data: AuthLoginDto) {
        return this.authService.login(data);
    }

    @Post('google')
    @ApiOperation({ summary: 'เข้าสู่ระบบด้วย Google (ยังไม่เปิดใช้งาน)' })
    google() {
        return this.authService.loginWithGoogle();
    }
}
