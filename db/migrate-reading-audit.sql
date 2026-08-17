-- =====================================================================
-- ร่องรอยการตรวจ: ธงเตือน / วิธีกรอกเลข / กันซิงก์ซ้ำจาก offline
--
-- ก่อน migration นี้ ปุ่ม confirm_* ทุกตัวกดข้ามด่านได้แบบ "ผ่านแล้วไม่เหลืออะไร"
-- ระบบจึงตอบไม่ได้เลยว่าเดือนที่แล้วมีใครกดข้ามด่านไหนไปกี่ครั้ง ซึ่งเป็นข้อมูล
-- ชิ้นเดียวที่แยก "เจอเคสแปลกจริง" ออกจาก "กดผ่านทุกใบจนด่านไร้ความหมาย" ได้
--
-- รันคำสั่งนี้ครั้งเดียว:
--   mysql -u root water-bill-db < db/migrate-reading-audit.sql
-- =====================================================================

USE `water-bill-db`;

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) reading_flags — ธงที่ติดไว้กับการจดแต่ละครั้ง
--
-- 1 แถว = 1 ครั้งที่ระบบเตือนแล้วคนตัดสินใจอย่างไร ทั้งแบบที่กดยืนยันข้าม
-- (confirm_*) และแบบที่เตือนเฉย ๆ ไม่ต้องกดอะไร (usage_warning)
--
-- แยกตารางแทนคอลัมน์ใน meter_readings เพราะการจดครั้งเดียวติดได้หลายธงพร้อมกัน
-- (พิกัดซ้ำ + หน่วยพุ่ง + อ่านไม่ชัด) และจำนวนชนิดธงจะเพิ่มขึ้นตามเวลา
-- ถ้าเป็นคอลัมน์ก็ต้อง ALTER ทุกครั้งที่เพิ่มด่านใหม่
--
-- ไม่ผูก FK ไปที่ admin เพราะ confirmed_by เป็น "ใครกด" ซึ่งบัญชีอาจถูกลบทีหลัง
-- แต่ร่องรอยต้องอยู่ต่อ — ธงที่หายไปพร้อมบัญชีคือธงที่ไม่มีประโยชน์
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `reading_flags` (
  `id` int NOT NULL AUTO_INCREMENT,
  `meter_readings_id` int NOT NULL COMMENT 'การจดที่ธงนี้ติดอยู่',
  `flag_type` enum(
    'duplicate_location',
    'burst_photo',
    'future_timestamp',
    'stale_photo',
    'meter_reset',
    'high_usage',
    'usage_warning',
    'digit_change',
    'low_confidence',
    'manual_entry',
    'offline_sync'
  ) NOT NULL,
  `detail` varchar(500) DEFAULT NULL COMMENT 'ตัวเลข/ข้อความประกอบ ณ ตอนที่ติดธง',
  `confirmed_by` int DEFAULT NULL COMMENT 'admin.id ของคนที่กดยืนยันข้ามด่าน (NULL = ระบบติดเอง)',
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_flags_reading` (`meter_readings_id`),
  KEY `ix_flags_type` (`flag_type`, `create_date`),
  CONSTRAINT `fk_flags_reading` FOREIGN KEY (`meter_readings_id`)
    REFERENCES `meter_readings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 2) meter_readings.entry_method — เลขนี้มาจากไหน
--
-- ของเดิมแยกไม่ออกว่าแถวไหนกรอกมือ ต้องเดาจาก meter_digits IS NULL
-- ซึ่งไม่ตรงเสมอไป (OCR อ่านได้แต่ไม่ส่งจำนวนหลักมาก็เป็น NULL เหมือนกัน)
--
-- ต้องแยกให้ชัดเพราะกฎ "กรอกมือต้องแนบรูปเสมอ" พึ่งค่านี้ตัวเดียว —
-- กรอกมือคือจุดที่ไม่มีอะไรตรวจเลขได้เลยนอกจากรูปหน้าปัด
--
-- DEFAULT 'ocr' = แถวเก่าทั้งหมดถือว่ามาจากทางเดิม ไม่ไปบังคับย้อนหลัง
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `meter_readings`
  ADD COLUMN `entry_method` enum('ocr','manual','manual_after_ocr_fail')
    NOT NULL DEFAULT 'ocr'
    COMMENT 'เลขมิเตอร์มาจาก OCR หรือคนกรอกเอง'
    AFTER `read_confidence`;

-- ─────────────────────────────────────────────────────────────────────
-- 3) meter_readings.client_uuid — กันซิงก์ซ้ำจากมือถือที่ทำงาน offline
--
-- หน้างานไม่มีสัญญาณ แอปจะเก็บการจดไว้ในเครื่องก่อนแล้วค่อยยิงตอนมีเน็ต
-- ปัญหาคือ "ยิงแล้วเน็ตหลุดก่อนได้รับคำตอบ" แยกไม่ออกจาก "ยิงไม่สำเร็จ"
-- แอปจึงต้องยิงซ้ำ ซึ่งถ้าไม่มีอะไรกันจะได้บิลสองใบของเดือนเดียวกัน
--
-- ต้องเป็น UNIQUE ระดับฐานข้อมูล ไม่ใช่ SELECT ก่อน INSERT ที่ชั้น service
-- เพราะการยิงซ้ำสองครั้งพร้อมกันจะ SELECT ไม่เจอทั้งคู่แล้ว INSERT ทั้งคู่
--
-- NULL ซ้ำกันได้ใน MySQL แถวเก่าที่ไม่มีค่าจึงไม่ชนกันเอง
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `meter_readings`
  ADD COLUMN `client_uuid` char(36) DEFAULT NULL
    COMMENT 'รหัสที่มือถือสร้างตอนกดบันทึก ใช้กันยิงซ้ำตอน auto-sync',
  ADD UNIQUE KEY `uq_reading_client_uuid` (`client_uuid`);

-- ─────────────────────────────────────────────────────────────────────
-- 4) meter_readings.photo_purged_at — รูปถูกลบตามอายุแล้วเมื่อไหร่
--
-- cron ลบรูปของบิลที่เคลียร์แล้วเกิน 1 ปี แต่ **ไม่ล้าง evidence_photo ทิ้ง**
-- เพราะ path ที่ยังอยู่คือหลักฐานว่า "เคยมีรูป" ต่างจาก NULL ที่แปลว่า
-- "ไม่เคยถ่ายเลย" — สองอย่างนี้ต่างกันมากเวลาย้อนไปตรวจ
--
-- หน้าเว็บต้องเช็คคอลัมน์นี้ก่อนขึ้นรูป ไม่งั้นจะได้ 404 จากไฟล์ที่ถูกลบไปแล้ว
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `meter_readings`
  ADD COLUMN `photo_purged_at` datetime DEFAULT NULL
    COMMENT 'เวลาที่ไฟล์รูปถูกลบตามนโยบายเก็บ 1 ปี (NULL = ไฟล์ยังอยู่)'
    AFTER `evidence_photo`;

-- ตรวจผลลัพธ์
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'water-bill-db' AND TABLE_NAME = 'meter_readings'
  AND COLUMN_NAME IN ('entry_method', 'client_uuid', 'photo_purged_at');

SELECT COUNT(*) AS `reading_flags_exists`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'water-bill-db' AND TABLE_NAME = 'reading_flags';
