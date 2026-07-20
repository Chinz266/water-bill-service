import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC_KEY, JwtPayload } from './auth.constants';

/**
 * ยามด่านแรก: ตรวจว่ามี JWT ที่ถูกต้องติดมากับ request ไหม
 * ถ้าผ่านจะแปะข้อมูลผู้ใช้ไว้ที่ request.user ให้ RolesGuard และ controller ใช้ต่อ
 *
 * ถูกตั้งเป็น global ใน app.module → ทุก endpoint ปิดเป็นค่าเริ่มต้น
 * ยกเว้น route ที่แปะ @Public() ไว้
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly reflector: Reflector,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // route ที่ประกาศ @Public() ไว้ให้ผ่านเลย (login / register)
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }

        const request = context.switchToHttp().getRequest<Request>();
        const token = this.extractToken(request);
        if (!token) {
            throw new UnauthorizedException('กรุณาเข้าสู่ระบบก่อนใช้งาน');
        }

        try {
            const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
            // แปะไว้ให้ RolesGuard ตรวจ role ต่อ และให้ controller รู้ว่าใครเป็นคนเรียก
            (request as Request & { user?: JwtPayload }).user = payload;
            return true;
        } catch {
            // ครอบคลุมทั้ง token ปลอม, ลายเซ็นไม่ตรง และ token หมดอายุ
            throw new UnauthorizedException('เซสชันหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
        }
    }

    /** ดึง token จาก header รูปแบบ `Authorization: Bearer <token>` */
    private extractToken(request: Request): string | undefined {
        const [type, token] = request.headers.authorization?.split(' ') ?? [];
        return type === 'Bearer' ? token : undefined;
    }
}
