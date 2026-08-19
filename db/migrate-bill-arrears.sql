-- =====================================================================
-- ทบยอดค้างชำระเข้าบิลเดือนถัดไป
--
-- ก่อนหน้านี้บ้านที่ไม่จ่ายเดือนนี้จะได้บิลเดือนหน้าที่มีแต่ค่าน้ำเดือนหน้า
-- ยอดเก่าค้างอยู่เป็นบิลอีกใบที่ไม่มีอะไรเชื่อมถึงกัน คนเก็บเงินต้องบวกเอง
-- ทุกครั้งก่อนออกไปทวง และลูกบ้านก็ไม่เห็นยอดจริงที่ต้องจ่ายบนใบที่ได้รับ
--
-- ⚠️ ห้ามเอายอดค้างไปบวกใน total_amount เด็ดขาด — ทั้งระบบ (usageBaseline,
--    outstandingByMember, รายงานรายได้) อ่านคอลัมน์นั้นว่า "ค่าน้ำของเดือนนี้"
--    เอายอดเก่าไปปนจะทำให้ยอดค้างถูกนับซ้ำทุกเดือนที่ทบต่อกันไป
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-bill-arrears.sql
-- =====================================================================

USE `water-bill-db`;

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) bills.arrears_amount / grand_total
--
-- arrears_amount = ภาพนิ่งของยอดค้างสะสม ณ วินาทีที่ออกบิลใบนี้
-- grand_total    = total_amount + arrears_amount = ตัวเลขที่พิมพ์บนใบเสร็จ
--
-- เก็บเป็นภาพนิ่ง ไม่คิดสดตอนแสดงผล เพราะใบที่พิมพ์ส่งให้ลูกบ้านไปแล้ว
-- ต้องตรงกับที่ระบบบอกเสมอ ต่อให้มีคนไปจ่ายบิลเก่าทีหลังก็ตาม
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `bills`
  ADD COLUMN `arrears_amount` decimal(10,2) NOT NULL DEFAULT 0.00
    COMMENT 'ยอดค้างจากบิลเก่าที่ทบเข้ามาในใบนี้ (ภาพนิ่ง ณ วันออกบิล)'
    AFTER `total_amount`,
  ADD COLUMN `grand_total` decimal(10,2) DEFAULT NULL
    COMMENT 'ยอดที่ต้องจ่ายจริงบนใบนี้ = total_amount + arrears_amount (NULL = บิลเก่าก่อน migration)'
    AFTER `arrears_amount`;

-- ─────────────────────────────────────────────────────────────────────
-- 2) bill_arrears — ใบใหม่ทบยอดของใบไหนมาบ้าง
--
-- ต้องรู้รายใบ ไม่ใช่แค่ยอดรวม เพราะตอนรับเงินต้องปิดใบเก่าทุกใบที่ถูกทบ
-- ให้เป็น Paid ในทรานแซกชันเดียวกัน ถ้าไม่ปิด ยอดเดิมจะถูกทบเข้าไปใน
-- บิลเดือนถัดไปอีกรอบ กลายเป็นเก็บเงินซ้ำจากก้อนที่จ่ายไปแล้ว
--
-- ON DELETE CASCADE ทั้งสองทาง — ลบบิลใบไหนก็ตาม ความสัมพันธ์ที่ค้างอยู่
-- ไม่มีความหมายอีกแล้ว (BillsService.remove ลบใบที่ยังไม่จ่ายได้)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bill_arrears` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bill_id` int NOT NULL COMMENT 'บิลใบใหม่ที่ทบยอดเข้ามา',
  `covered_bill_id` int NOT NULL COMMENT 'บิลใบเก่าที่ถูกทบ',
  `amount` decimal(10,2) NOT NULL COMMENT 'ยอดของใบเก่า ณ ตอนที่ทบ',
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_arrears_pair` (`bill_id`, `covered_bill_id`),
  KEY `ix_arrears_covered` (`covered_bill_id`),
  CONSTRAINT `fk_arrears_bill` FOREIGN KEY (`bill_id`)
    REFERENCES `bills` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_arrears_covered` FOREIGN KEY (`covered_bill_id`)
    REFERENCES `bills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 3) เติม grand_total ให้บิลเก่า
--
-- บิลเก่าไม่เคยมียอดทบ grand_total จึงเท่ากับ total_amount พอดี
-- เติมย้อนหลังได้อย่างปลอดภัยเพราะไม่ได้เดาอะไรเลย (ต่างจาก due_date
-- ที่ตั้งใจปล่อยเป็น NULL เพราะกำหนดชำระที่คิดเองทีหลังไม่ใช่ข้อเท็จจริง)
-- ─────────────────────────────────────────────────────────────────────
UPDATE `bills` SET `grand_total` = `total_amount` WHERE `grand_total` IS NULL;

-- ตรวจผลลัพธ์
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'water-bill-db' AND TABLE_NAME = 'bills'
  AND COLUMN_NAME IN ('arrears_amount', 'grand_total');
