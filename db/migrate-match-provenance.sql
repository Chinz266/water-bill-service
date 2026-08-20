-- =====================================================================
-- เก็บร่องรอยว่า "บ้านของบิลใบนี้ ใครเป็นคนเลือก และตอนนั้นมั่นใจแค่ไหน"
--
-- ทำไมต้องเก็บ:
--
--   ระบบออกบิลให้เองได้อยู่แล้วเมื่อจับคู่บ้านจากเลขมิเตอร์ได้แบบ high
--   (ScanBatchService.judge → BatchScanComponent.autoSavable) แต่ทุกวันนี้พอบิล
--   ออกไปแล้ว **ไม่เหลือร่องรอยเลยว่าใบนั้นระบบเลือกบ้านเองหรือคนเป็นคนเลือก**
--   meter_readings เก็บแค่ entry_method ซึ่งตอบเรื่อง "เลข" ไม่ได้ตอบเรื่อง "บ้าน"
--
--   ผลคือคำถามที่ต้องตอบก่อนจะผ่อนหรือรัดเกณฑ์การออกบิลอัตโนมัติ —
--   "ที่ระบบเลือกเองอยู่ตอนนี้ ผิดกี่เปอร์เซ็นต์" — ตอบไม่ได้เลยสักทาง
--   การขยับเกณฑ์โดยไม่รู้ค่านี้คือการเดา ไม่ใช่การตัดสินใจ
--
-- ⚠️ สองคอลัมน์นี้เป็น **หลักฐานย้อนหลังเท่านั้น** ห้ามเอาไปเป็นเงื่อนไขของด่านใด ๆ
--    ค่ามาจาก client ซึ่งปลอมได้ (ต่างจาก read_confidence ที่หลังบ้านคำนวณเอง)
--    ด่านที่ตัดสินเรื่องเงินต้องยืนบนค่าที่หลังบ้านคิดเองเท่านั้น
--
-- ─────────────────────────────────────────────────────────────────────
-- ทำไมต้องมีตารางบันทึกการลบบิลด้วย
--
--   บ้านของบิลที่ออกไปแล้ว **แก้ไม่ได้** (UpdateReadingDto ไม่มี members_id)
--   ทางแก้ "ออกบิลผิดบ้าน" จึงมีทางเดียวคือลบใบนั้นทิ้งแล้วออกใหม่ให้บ้านที่ถูก
--
--   และ BillsService.remove() ลบทั้งบิลและ meter_readings ในทรานแซกชันเดียว
--   แถวที่ถือ matched_by อยู่จึงหายไปพร้อมกัน — พอดีกับจังหวะที่มันมีค่าที่สุด
--   เท่ากับหลักฐานของ "ระบบเลือกผิด" ถูกลบทิ้งทุกครั้งที่มีคนไปแก้ให้ถูก
--
--   ตารางนี้จึงเก็บสำเนาไว้ก่อนลบ ทำให้นับได้ตรง ๆ ว่าบิลที่ระบบเลือกบ้านเอง
--   ถูกลบทิ้งทีหลังกี่ใบ เทียบกับที่คนเลือกเอง — ซึ่งคือตัวเลขที่ต้องใช้
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-match-provenance.sql
-- =====================================================================

USE `water-bill-db`;

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ที่มาของ "บ้าน" ในการจดแต่ละครั้ง
--
-- ค่าตรงกับ ScanRow.matchedBy / matchConfidence ของหน้าเว็บคำต่อคำ ไม่แปลงชื่อ
-- ระหว่างทาง — ค่าที่ชื่อไม่ตรงกันสองฝั่งคือค่าที่ไล่ย้อนกลับไม่ได้เวลาสงสัย
--
-- NULL = การจดที่เกิดก่อนมีคอลัมน์นี้ หรือมาจากทางที่ไม่ได้ผ่านหน้าสแกน
-- (จดหน้างานทีละหลัง / คิวที่ยังไม่ระบุบ้าน) ตั้งใจไม่เติมย้อนหลังให้
-- เพราะเดาไม่ได้ว่าแถวเก่าแถวไหนระบบเป็นคนเลือก
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `meter_readings`
  ADD COLUMN `matched_by` enum('system','manual','none') DEFAULT NULL
    COMMENT 'ใครเลือกบ้านให้การจดครั้งนี้ (NULL = ไม่ได้มาจากหน้าสแกน) — หลักฐานย้อนหลังเท่านั้น ห้ามใช้เป็นด่าน'
    AFTER `entry_method`,
  ADD COLUMN `match_confidence` enum('high','medium','ambiguous','none') DEFAULT NULL
    COMMENT 'ความมั่นใจของการจับคู่บ้าน ณ ตอนออกบิล — หลักฐานย้อนหลังเท่านั้น ห้ามใช้เป็นด่าน'
    AFTER `matched_by`;

-- ไล่ดูสัดส่วนได้ทันทีหลังรันไปหนึ่งรอบบิล
CREATE INDEX `ix_readings_matched_by`
  ON `meter_readings` (`matched_by`, `match_confidence`);

-- ─────────────────────────────────────────────────────────────────────
-- 2) ร่องรอยการลบบิล
--
-- ไม่ผูก FK ไปที่ bills / meter_readings / members / admin เลยสักตัว —
-- เหตุผลเดียวกับ meter_reading_logs: log คือ "เหตุการณ์ที่เกิดขึ้นแล้ว"
-- ซึ่งต้องอยู่ต่อแม้ของที่มันพูดถึงจะถูกลบไปหมดแล้ว (ซึ่งในตารางนี้คือเสมอ)
--
-- house_no เก็บซ้ำเป็นข้อความ ไม่ใช่แค่ members_id เพราะบ้านถูกลบทีหลังได้
-- แล้ว log ที่เหลือแต่เลข id จะอ่านไม่ออกว่าหมายถึงบ้านหลังไหน
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bill_deletion_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bills_id` int NOT NULL COMMENT 'บิลที่ถูกลบ (ไม่ผูก FK — แถวนั้นไม่มีอยู่แล้ว)',
  `meter_readings_id` int DEFAULT NULL COMMENT 'การจดที่ถูกลบไปพร้อมกัน',
  `members_id` int DEFAULT NULL COMMENT 'บ้านที่ถูกออกบิลให้ (บ้านที่อาจถูกเลือกผิด)',
  `house_no` varchar(50) DEFAULT NULL COMMENT 'เลขที่บ้าน ณ ตอนลบ — เก็บซ้ำไว้ให้อ่านออกแม้บ้านถูกลบทีหลัง',
  `billing_month` char(2) DEFAULT NULL,
  `billing_year` char(4) DEFAULT NULL,
  `meter_unit` int DEFAULT NULL COMMENT 'เลขมิเตอร์ของใบที่ถูกลบ',
  `total_amount` decimal(10,2) DEFAULT NULL,
  `matched_by` enum('system','manual','none') DEFAULT NULL
    COMMENT 'สำเนาจาก meter_readings ก่อนลบ — คอลัมน์ที่ตอบว่า "ระบบเลือกเองแล้วผิด" หรือเปล่า',
  `match_confidence` enum('high','medium','ambiguous','none') DEFAULT NULL,
  `entry_method` enum('ocr','manual','manual_after_ocr_fail') DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL COMMENT 'เหตุผลที่ลบ (ถ้าคนกรอกมา) — replace = ถูกจดทับด้วยใบใหม่ของบ้านเดียวกัน',
  `deleted_by` int DEFAULT NULL COMMENT 'admin.id ของคนที่สั่งลบ',
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_bill_deletions_matched` (`matched_by`, `match_confidence`, `create_date`),
  KEY `ix_bill_deletions_member` (`members_id`, `create_date`),
  KEY `ix_bill_deletions_bill` (`bills_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ตรวจผลลัพธ์
SELECT
  COUNT(*) AS `bill_deletion_logs_exists`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'water-bill-db' AND TABLE_NAME = 'bill_deletion_logs';

SELECT
  COUNT(*) AS `provenance_columns_added`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'water-bill-db'
  AND TABLE_NAME = 'meter_readings'
  AND COLUMN_NAME IN ('matched_by', 'match_confidence');

-- ═════════════════════════════════════════════════════════════════════
-- คิวรีที่ตารางนี้มีไว้ตอบ — รันหลังจดครบหนึ่งรอบบิล
--
-- อัตราการลบของบิลที่ระบบเลือกบ้านเอง เทียบกับที่คนเลือกเอง
-- (ตัวหารคือการจดที่ยังอยู่ + ที่ถูกลบไปแล้ว จึงต้องรวมสองตาราง)
-- ═════════════════════════════════════════════════════════════════════
-- SELECT
--   COALESCE(r.matched_by, d.matched_by)         AS matched_by,
--   COALESCE(r.match_confidence, d.match_confidence) AS match_confidence,
--   SUM(CASE WHEN d.id IS NULL THEN 1 ELSE 0 END) AS still_alive,
--   SUM(CASE WHEN d.id IS NOT NULL THEN 1 ELSE 0 END) AS deleted_later
-- FROM `meter_readings` r
-- LEFT JOIN `bill_deletion_logs` d ON d.meter_readings_id = r.id
-- WHERE COALESCE(r.matched_by, d.matched_by) IS NOT NULL
-- GROUP BY 1, 2
-- ORDER BY 1, 2;
