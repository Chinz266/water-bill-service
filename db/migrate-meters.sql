-- =====================================================================
-- ทะเบียนมิเตอร์ — 1 บ้านเปลี่ยนมิเตอร์ได้หลายตัวตลอดอายุการใช้งาน
--
-- ของเดิมรับ old_meter_final_unit มาเป็นค่าครั้งเดียวตอนออกบิลแล้วทิ้ง
-- ระบบจึงตอบไม่ได้เลยว่ามิเตอร์ตัวไหนถูกถอดเมื่อไหร่ ปิดที่เลขเท่าไหร่
-- เวลาลูกบ้านทักท้วงว่า "เดือนที่เปลี่ยนมิเตอร์คิดเงินเกิน" ไม่มีอะไรให้ไล่ดู
--
-- ผลพลอยได้อีกอย่าง: meters.digits ทำให้ด่านจำนวนหลักครอบตั้งแต่บิลใบแรก
-- ของบ้านหลังนั้น จากเดิมที่ต้องรอให้จดผ่าน OCR ครบสองครั้งก่อน
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-meters.sql
-- =====================================================================

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) meters — มิเตอร์แต่ละตัวที่เคยติดตั้งให้บ้านหลังหนึ่ง
--
-- removed_at IS NULL = ตัวที่ใช้อยู่ปัจจุบัน (1 บ้านควรมีได้ตัวเดียว
-- แต่ไม่บังคับด้วย unique index เพราะช่วงเปลี่ยนถ่ายมีจังหวะที่ทับกันได้
-- และการบล็อกตรงนี้จะทำให้แก้ข้อมูลที่กรอกผิดยากกว่าเดิม)
--
-- final_unit = เลขปิดของตัวเก่า ณ วันถอด — ตัวเลขที่ใช้คิดน้ำที่ใช้ไป
-- ก่อนถอดออก ไม่มีค่านี้ก็คิดเฉพาะมิเตอร์ตัวใหม่ (คิดขาดดีกว่าคิดเกิน)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `meters` (
  `id` int NOT NULL AUTO_INCREMENT,
  `members_id` int NOT NULL,
  `serial_no` varchar(45) DEFAULT NULL COMMENT 'เลขเครื่องบนตัวมิเตอร์',
  `digits` tinyint unsigned DEFAULT NULL COMMENT 'จำนวนหลักบนหน้าปัด (นับเลขศูนย์นำหน้าด้วย)',
  `installed_at` date NOT NULL,
  `removed_at` date DEFAULT NULL COMMENT 'NULL = ตัวที่ใช้อยู่ตอนนี้',
  `initial_unit` int NOT NULL DEFAULT 0 COMMENT 'เลขบนหน้าปัดตอนติดตั้ง (ตัวใหม่ปกติ = 0)',
  `final_unit` int DEFAULT NULL COMMENT 'เลขปิด ณ วันถอด',
  `note` varchar(255) DEFAULT NULL COMMENT 'เหตุผลที่เปลี่ยน เช่น หน้าปัดฝ้า เข็มค้าง',
  -- น้ำที่ใช้บนตัวเก่าก่อนถอด ถูกคิดเข้าบิลใบไหนไปแล้วหรือยัง
  --
  -- ต้องมีคอลัมน์นี้ ไม่งั้นระบบแยกไม่ออกว่า final_unit ถูกคิดไปแล้วหรือยังรออยู่
  -- แล้วจะบวกหน่วยก้อนเดิมเข้าไปในบิลทุกใบหลังจากนั้น — ลูกบ้านโดนเก็บซ้ำทุกเดือน
  `residual_billed_at` datetime DEFAULT NULL
    COMMENT 'เวลาที่หน่วยค้างของตัวนี้ถูกคิดเข้าบิลแล้ว (NULL = ยังรอคิด)',
  `residual_bill_id` int DEFAULT NULL COMMENT 'บิลที่คิดหน่วยค้างก้อนนี้เข้าไป',
  `create_by` int DEFAULT NULL,
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_meters_member` (`members_id`, `installed_at`),
  CONSTRAINT `fk_meters_member` FOREIGN KEY (`members_id`)
    REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 2) meter_readings.meters_id — การจดครั้งนี้อ่านจากมิเตอร์ตัวไหน
--
-- NULL = การจดก่อนมีทะเบียนมิเตอร์ ตั้งใจไม่เติมย้อนหลัง เพราะเดาไม่ได้ว่า
-- แถวเก่าแถวไหนอ่านจากตัวไหน — การเดาแล้วเติมให้ครบดูสวยกว่าแต่เชื่อไม่ได้
--
-- ON DELETE SET NULL ไม่ใช่ CASCADE — ลบทะเบียนมิเตอร์ทิ้งไม่ควรลบประวัติ
-- การจดตามไปด้วย เพราะบิลทั้งสายพึ่งแถวพวกนั้นอยู่
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `meter_readings`
  ADD COLUMN `meters_id` int DEFAULT NULL
    COMMENT 'มิเตอร์ตัวที่อ่านค่านี้มา (NULL = ก่อนมีทะเบียนมิเตอร์)'
    AFTER `members_id1`,
  ADD KEY `ix_readings_meter` (`meters_id`),
  ADD CONSTRAINT `fk_readings_meter` FOREIGN KEY (`meters_id`)
    REFERENCES `meters` (`id`) ON DELETE SET NULL;

-- ตรวจผลลัพธ์
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meter_readings'
  AND COLUMN_NAME = 'meters_id';

SELECT COUNT(*) AS `meters_table_exists`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meters';
