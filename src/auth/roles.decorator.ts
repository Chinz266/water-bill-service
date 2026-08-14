import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY, UserRole } from './auth.constants';

/**
 * จำกัดว่า route นี้ต้องเป็น role ไหนถึงเรียกได้ เช่น @Roles('admin')
 * ถ้าไม่แปะไว้ = ล็อกอินแล้วเข้าได้ทุก role
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
