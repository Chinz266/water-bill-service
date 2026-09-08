-- =====================================================================
-- ผู้อยู่อาศัยแต่ละช่วง + บิลปิดยอดตอนย้ายออก (Move-out Billing)
--
-- ⚠️ ฟีเจอร์นี้ถูกถอดออกจากระบบแล้ว (ทั้งหน้าเว็บและ NestJS) ไฟล์นี้ยังอยู่เพราะ
--    ตารางถูกสร้างไปแล้วในฐานข้อมูลจริง และ bills.tenancy_id ของบิลเก่าชี้มาที่นี่
--    อย่าลบไฟล์นี้และอย่า DROP ตาราง — สมุด schema_migrations จดชื่อไฟล์นี้ไว้
--
-- บ้านเช่าเปลี่ยนผู้เช่ากลางเดือนเป็นเรื่องปกติ ของเดิมระบบรู้จักแค่ "บ้าน"
-- ค่าน้ำทั้งเดือนจึงตกกับใครก็ตามที่ชื่ออยู่ในทะเบียนตอนสิ้นเดือน — คนใหม่
-- ที่เพิ่งย้ายเข้าวันที่ 25 ได้บิลของทั้งเดือนรวมส่วนที่คนเก่าใช้ไป
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-tenancies.sql
-- =====================================================================

-- ต้องรันหลังไฟล์เหล่านี้ (ตัวรันจัดลำดับให้เองตามบรรทัดนี้ ดู scripts/migrate.ts):
--   migrate-bill-arrears.sql — FK ไปที่ bills หลังคอลัมน์ยอดค้างถูกเพิ่มแล้ว
--   migrate-bill-audit.sql — ต่อท้าย bills.period_months
-- requires: migrate-bill-arrears.sql, migrate-bill-audit.sql

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) tenancies — ช่วงเวลาที่แต่ละคนอยู่บ้านหลังนี้
--
-- end_date IS NULL = คนที่อยู่ปัจจุบัน
--
-- ไม่ย้ายชื่อออกจาก members เพราะทั้งระบบอ้าง members.fname/lname อยู่
-- ตารางนี้เป็นชั้นประวัติที่วางทับ ไม่ใช่ตัวแทน — ชื่อใน members ยังคงเป็น
-- "ผู้อยู่ปัจจุบัน" เหมือนเดิม ส่วนคนก่อนหน้าย้อนดูได้จากที่นี่
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `tenancies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `members_id` int NOT NULL,
  `occupant_name` varchar(90) NOT NULL COMMENT 'ชื่อ-นามสกุลผู้อยู่อาศัยช่วงนี้',
  `phone` varchar(20) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL COMMENT 'NULL = ยังอยู่ปัจจุบัน',
  `create_by` int DEFAULT NULL,
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_tenancy_member` (`members_id`, `start_date`),
  CONSTRAINT `fk_tenancy_member` FOREIGN KEY (`members_id`)
    REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 2) bills.tenancy_id / is_final
--
-- is_final = บิลปิดยอด ณ วันย้ายออก ไม่ใช่บิลประจำเดือนตามปกติ
-- ต่างกันสองอย่างที่ต้องแยกให้ออก:
--   - due_date เป็นวันย้ายออกเลย ไม่ยืดตาม payment_due_days ของหมู่บ้าน
--     (คนที่ย้ายออกไปแล้วตามเก็บทีหลังแทบไม่ได้)
--   - reading_date อยู่กลางเดือนได้ตามปกติ ไม่ผิดกฎ 15 วัน
--
-- tenancy_id NULL = บิลที่ออกก่อนมีตารางนี้ หรือบ้านที่เจ้าของอยู่เอง
-- (ไม่บังคับให้ทุกบ้านต้องมี tenancy — บ้านเจ้าของอยู่เองไม่มีอะไรให้บันทึก)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `bills`
  ADD COLUMN `tenancy_id` int DEFAULT NULL
    COMMENT 'ผู้อยู่อาศัยที่บิลใบนี้เรียกเก็บจาก (NULL = เจ้าของอยู่เอง/บิลเก่า)'
    AFTER `period_months`,
  ADD COLUMN `is_final` tinyint(1) NOT NULL DEFAULT 0
    COMMENT '1 = บิลปิดยอดตอนย้ายออก ไม่ใช่บิลประจำเดือน'
    AFTER `tenancy_id`,
  ADD KEY `ix_bills_tenancy` (`tenancy_id`),
  ADD CONSTRAINT `fk_bills_tenancy` FOREIGN KEY (`tenancy_id`)
    REFERENCES `tenancies` (`id`) ON DELETE SET NULL;

-- ตรวจผลลัพธ์
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bills'
  AND COLUMN_NAME IN ('tenancy_id', 'is_final');

SELECT COUNT(*) AS `tenancies_table_exists`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenancies';
