// ค่าคงที่ที่ guard / decorator ใช้ร่วมกัน แยกไว้กันการ import วนไปวนมา (circular import)

/** key ของ metadata ที่บอกว่า route นี้เข้าได้โดยไม่ต้องล็อกอิน */
export const IS_PUBLIC_KEY = 'isPublic';

/** key ของ metadata ที่บอกว่า route นี้ต้องเป็น role ไหนถึงเข้าได้ */
export const ROLES_KEY = 'roles';

/** role ที่ระบบรองรับ — admin คือผู้ดูแลหมู่บ้าน, member คือลูกบ้านที่ดูบิลตัวเอง */
export type UserRole = 'admin' | 'member';

/**
 * สิทธิ์ภายในฝั่งผู้ดูแล — owner แก้บิลย้อนหลังได้ตลอด, staff แก้ได้จำกัด
 *
 * แยกจาก UserRole เพราะตอบคนละคำถาม: UserRole บอกว่า "เข้าหน้าไหนได้"
 * ส่วนตัวนี้บอกว่า "แก้ของที่ออกไปแล้วได้แค่ไหน" (ดู BillsService.updateReading)
 */
export type AdminRole = 'owner' | 'staff';

/** ข้อมูลที่ฝังอยู่ใน JWT และถูกแปะไว้ที่ request.user หลังผ่าน guard */
export interface JwtPayload {
  /** id ของบัญชี (มาตรฐาน JWT ใช้ชื่อ sub) */
  sub: number;
  // 🌟 nullable เพราะบัญชีลูกบ้าน (role='member') ล็อกอินด้วยเบอร์ ไม่มีอีเมล
  email: string | null;
  role: UserRole;
  /**
   * สิทธิ์ผู้ดูแล — ไม่มีค่า = token ที่ออกก่อน migrate-admin-role.sql
   *
   * ⚠️ ฝั่งที่อ่านต้องถือว่า "ไม่มีค่า = staff" เสมอ ไม่ใช่ owner
   *    ไม่งั้น token เก่าที่ยังไม่หมดอายุจะกลายเป็นทางลัดข้ามด่านนี้ทั้งด่าน
   */
  admin_role?: AdminRole;
}
