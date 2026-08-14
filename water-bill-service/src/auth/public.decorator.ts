import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './auth.constants';

/**
 * แปะบน route ที่ต้องเข้าได้โดยไม่ต้องมี token (เช่น login / register)
 *
 * ⚠️ เนื่องจาก JwtAuthGuard ถูกตั้งเป็น global (ปิดทุกประตูเป็นค่าเริ่มต้น)
 *    route ไหนที่ "ตั้งใจ" ให้เปิดสาธารณะต้องแปะ @Public() เท่านั้น
 *    วิธีนี้ปลอดภัยกว่าการไล่แปะ guard ทีละ route เพราะถ้าลืมแปะ = ปิดไว้ ไม่ใช่เปิดทิ้ง
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
