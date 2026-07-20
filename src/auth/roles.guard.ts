import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY, JwtPayload, ROLES_KEY, UserRole } from './auth.constants';

/**
 * ยามด่านสอง: ตรวจ role หลังจาก JwtAuthGuard ยืนยันตัวตนแล้ว
 * ทำงานเฉพาะ route ที่แปะ @Roles(...) ไว้เท่านั้น
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) {
            return true;
        }

        const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        // ไม่ได้ระบุ role ไว้ = ล็อกอินแล้วเข้าได้ทุกคน
        if (!requiredRoles || requiredRoles.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
        const user = request.user;
        if (!user || !requiredRoles.includes(user.role)) {
            throw new ForbiddenException('คุณไม่มีสิทธิ์ใช้งานส่วนนี้');
        }
        return true;
    }
}
