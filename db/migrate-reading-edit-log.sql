-- =====================================================================
-- ร่องรอยการแก้เลขมิเตอร์หลังออกบิลไปแล้ว
--
-- PATCH /bills/:id/reading เปลี่ยน "ยอดเงินที่ลูกบ้านต้องจ่าย" ของบิลที่ออกไปแล้ว
-- ถ้าไม่มีตารางนี้ การแก้จะทับของเดิมจนหายไปทั้งหมด — ระบบตอบไม่ได้เลยว่าใบนี้
-- เคยเป็นเท่าไหร่ ใครแก้ ตอนไหน และด้วยเหตุผลอะไร ซึ่งเป็นข้อมูลชิ้นเดียวที่
-- แยก "แก้เพราะ OCR อ่านผิด" ออกจาก "แก้ยอดให้ใครสักคน" ได้
--
-- reason จึงเป็น NOT NULL — การแก้ที่ไม่มีเหตุผลกำกับมีค่าเท่ากับไม่มีร่องรอย
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-reading-edit-log.sql
-- =====================================================================

USE `water-bill-db`;

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- ไม่ผูก FK ไปที่ bills / meter_readings / admin เลยสักตัว
--
-- ต่างจาก reading_flags ที่ผูก FK แบบ CASCADE ไว้ — ธงคือ "สถานะของการจดที่ยังอยู่"
-- ลบการจดทิ้งแล้วธงก็หมดความหมายตาม แต่ log การแก้คือ "เหตุการณ์ที่เกิดขึ้นแล้ว"
-- ซึ่งต้องอยู่ต่อแม้บิลจะถูกลบทีหลัง (โดยเฉพาะเมื่อคนที่ลบคือคนเดียวกับที่แก้)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `meter_reading_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bills_id` int NOT NULL COMMENT 'บิลที่ถูกแก้ (ไม่ผูก FK — log ต้องอยู่ต่อแม้บิลถูกลบ)',
  `meter_readings_id` int NOT NULL COMMENT 'การจดที่ถูกแก้เลข',
  `members_id` int DEFAULT NULL COMMENT 'บ้านเจ้าของบิล — เก็บซ้ำไว้เพื่อค้นย้อนหลังได้แม้การจดถูกลบ',
  `old_unit` int NOT NULL COMMENT 'เลขมิเตอร์ก่อนแก้',
  `new_unit` int NOT NULL COMMENT 'เลขมิเตอร์หลังแก้',
  `old_usage_unit` int NOT NULL,
  `new_usage_unit` int NOT NULL,
  `old_total_amount` decimal(10,2) NOT NULL,
  `new_total_amount` decimal(10,2) NOT NULL,
  `reason` varchar(500) NOT NULL COMMENT 'เหตุผลที่แก้ — บังคับกรอกเสมอ',
  `photo_replaced` tinyint NOT NULL DEFAULT 0 COMMENT '1 = แนบรูปหน้าปัดใหม่มาแทนของเดิม',
  `confirmed_flags` varchar(200) DEFAULT NULL COMMENT 'ด่านที่ถูกกดยืนยันข้ามในการแก้ครั้งนี้ (คั่นด้วย ,)',
  `changed_by` int DEFAULT NULL COMMENT 'admin.id ของคนที่แก้',
  `changed_role` enum('owner','staff') DEFAULT NULL COMMENT 'สิทธิ์ของคนที่แก้ ณ ตอนนั้น',
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_reading_logs_bill` (`bills_id`, `create_date`),
  KEY `ix_reading_logs_reading` (`meter_readings_id`),
  KEY `ix_reading_logs_member` (`members_id`, `create_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ตรวจผลลัพธ์
SELECT COUNT(*) AS `meter_reading_logs_exists`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'water-bill-db' AND TABLE_NAME = 'meter_reading_logs';
