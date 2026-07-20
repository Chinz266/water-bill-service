import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload } from './auth.constants';

/**
 * ดึงข้อมูลผู้ใช้ที่ล็อกอินอยู่มาใช้ใน controller เช่น
 *   findMyBills(@CurrentUser() user: JwtPayload) { ... }
 *
 * ใช้คู่กับการกรองข้อมูลตามเจ้าของ (ลูกบ้านเห็นเฉพาะบิลบ้านตัวเอง)
 * ⚠️ ห้ามรับ id เจ้าของจาก body/query ของหน้าบ้านเด็ดขาด เพราะผู้ใช้แก้ค่าเองได้
 *    ต้องอ่านจาก token ที่เซิร์ฟเวอร์เซ็นเองเท่านั้น
 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, context: ExecutionContext): JwtPayload | undefined => {
        const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
        return request.user;
    },
);
