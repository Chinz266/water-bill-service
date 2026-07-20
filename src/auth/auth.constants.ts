// ค่าคงที่ที่ guard / decorator ใช้ร่วมกัน แยกไว้กันการ import วนไปวนมา (circular import)

/** key ของ metadata ที่บอกว่า route นี้เข้าได้โดยไม่ต้องล็อกอิน */
export const IS_PUBLIC_KEY = 'isPublic';

/** key ของ metadata ที่บอกว่า route นี้ต้องเป็น role ไหนถึงเข้าได้ */
export const ROLES_KEY = 'roles';

/** role ที่ระบบรองรับ — admin คือผู้ดูแลหมู่บ้าน, member คือลูกบ้านที่ดูบิลตัวเอง */
export type UserRole = 'admin' | 'member';

/** ข้อมูลที่ฝังอยู่ใน JWT และถูกแปะไว้ที่ request.user หลังผ่าน guard */
export interface JwtPayload {
    /** id ของบัญชี (มาตรฐาน JWT ใช้ชื่อ sub) */
    sub: number;
    email: string;
    role: UserRole;
}
