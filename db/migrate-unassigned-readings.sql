-- =====================================================================
-- ข้อมูลกำพร้า — รูปที่จับคู่กับบ้านไม่ได้ ต้องรอ Admin จับคู่ทีหลัง
--
-- หน้างานเจอสองเคสที่ทำให้พนักงานได้รูปที่ยังไม่รู้ว่าของบ้านไหน:
--   1. OCR อ่านเลขไม่ออก (หน้าปัดฝ้า/โคลนบัง) จึงไม่มีเลขไปเทียบกับบ้านใดเลย
--   2. อ่านออกแต่เข้าได้หลายบ้านพอ ๆ กัน (ambiguous) คนกดยืนยันหน้างานไม่ได้
--
-- ของเดิมไม่มีที่ให้วาง คนจึงต้องเดาแล้วกดไปก่อน หรือทิ้งรูปแล้วเดินกลับไปใหม่
--
-- ═══ ทำไมเป็นตารางแยก ไม่ใช่ปล่อย meter_readings.members_id1 เป็น NULL ═══
--
-- คอลัมน์นั้น NOT NULL + FK และคิวรีทั้งระบบ (previous_unit, บิล, พิกัดที่เรียนรู้)
-- ตั้งอยู่บนสมมติฐานว่าการจดทุกแถวมีบ้านเจ้าของเสมอ การเปิดให้เป็น NULL
-- เท่ากับต้องไล่แก้เงื่อนไขทุกจุดพร้อมกัน และจุดที่ลืมจะเงียบ ไม่ error
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-unassigned-readings.sql
-- =====================================================================

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- evidence_photo เป็น NOT NULL ที่นี่ (ต่างจาก meter_readings ที่ยอมให้ว่าง)
--
-- เพราะแถวนี้ทั้งแถวมีไว้ให้คนมาตัดสินทีหลัง ถ้าไม่มีรูปก็ไม่เหลืออะไรให้ตัดสิน
-- เลยแม้แต่ชิ้นเดียว — เก็บไว้ก็เป็นแค่ขยะที่ไม่มีวันถูกจับคู่
--
-- meter_unit ยอมให้เป็น NULL ได้ (OCR อ่านไม่ออก) เพราะ Admin เปิดรูปดูแล้ว
-- พิมพ์เลขเองได้ ต่างจากรูปที่หายไปซึ่งกู้ไม่ได้
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `unassigned_readings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `villages_id` int DEFAULT NULL COMMENT 'หมู่บ้านที่กำลังเดินจดตอนถ่าย (ช่วยจำกัดรายชื่อบ้านตอนจับคู่)',
  `meter_unit` int DEFAULT NULL COMMENT 'เลขที่ OCR อ่านได้ (NULL = อ่านไม่ออก)',
  `meter_digits` tinyint unsigned DEFAULT NULL,
  `read_confidence` decimal(4,3) DEFAULT NULL,
  `evidence_photo` varchar(1000) NOT NULL COMMENT 'path รูปหน้าปัด — ไม่มีรูปก็ไม่มีอะไรให้ตัดสิน',
  `latitude` decimal(10,8) DEFAULT NULL,
  `longitude` decimal(11,8) DEFAULT NULL,
  `gps_accuracy_m` int DEFAULT NULL,
  `captured_at` datetime DEFAULT NULL,
  `status` enum('Pending','Assigned','Discarded') NOT NULL DEFAULT 'Pending',
  `resolved_reading_id` int DEFAULT NULL COMMENT 'การจดที่เกิดขึ้นจริงหลังจับคู่สำเร็จ',
  `resolved_by` int DEFAULT NULL,
  `resolved_date` datetime DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL COMMENT 'เหตุผลตอนตีทิ้ง หรือบันทึกของคนจับคู่',
  `create_by` int DEFAULT NULL,
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_unassigned_status` (`status`, `create_date`),
  KEY `ix_unassigned_village` (`villages_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ตรวจผลลัพธ์
SELECT COUNT(*) AS `unassigned_readings_exists`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unassigned_readings';
