// ค่าคงที่ของระบบแจ้งเรื่อง — ใช้ร่วมกันทั้ง DTO, service และหน้าเว็บ
// (แยกไว้ที่เดียวเพื่อไม่ให้รายการหมวดหมู่กระจายไปหลายไฟล์แล้วหลุดกันทีหลัง)

/**
 * หมวดหมู่เรื่องที่ลูกบ้านแจ้งได้
 *
 * 🌟 เก็บลง DB เป็น "รหัสภาษาอังกฤษ" ไม่ใช่ข้อความไทย
 *    เพราะถ้าเก็บข้อความไทยตรง ๆ วันหลังแก้คำพูดบนหน้าเว็บ ข้อมูลเก่าจะกลายเป็นคนละหมวดทันที
 *    ส่วนคำไทยที่ผู้ใช้เห็น ให้หน้าเว็บแปลจากรหัสนี้เอง
 */
export const REPORT_CATEGORIES = [
  'WATER_OUT', // น้ำไม่ไหล
  'WATER_DIRTY', // น้ำขุ่น/สกปรก
  'PIPE_LEAK', // ท่อแตก/น้ำรั่ว
  'METER_BROKEN', // มิเตอร์ผิดปกติ
  'BILL_WRONG', // บิลไม่ถูกต้อง
  'OTHER', // อื่น ๆ
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** สถานะการดำเนินการ — ตัวพิมพ์ต้องตรงกับ enum ใน Database */
export const REPORT_STATUSES = ['Pending', 'InProgress', 'Resolved'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** ความยาวรายละเอียดสูงสุด — กันคนวางข้อความยาวผิดปกติลงคอลัมน์ TEXT */
export const REPORT_DETAIL_MAX = 2000;

/**
 * ขนาดรูปแนบสูงสุด (ตัวอักษรของ base64 data URL)
 * MEDIUMTEXT เก็บได้ ~16MB แต่จำกัดไว้ ~2MB เพราะหน้าเว็บย่อรูปให้เหลือ 1024px ก่อนส่งอยู่แล้ว
 * ถ้าใหญ่กว่านี้แปลว่าไม่ได้ผ่านการย่อ ปฏิเสธไปดีกว่าปล่อยให้ตารางบวม
 */
export const REPORT_PHOTO_MAX = 2_000_000;
