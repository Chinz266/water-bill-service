-- =====================================================================
-- แยกบัญชีลูกบ้านออกจากตาราง `admin` มาอยู่ตาราง `accounts` ของตัวเอง
--
-- ทำไมต้องแยก:
--
--   ตาราง `admin` ทุกวันนี้เก็บสองอย่างที่ไม่เหมือนกันเลยไว้ด้วยกัน แล้วแยกด้วย
--   คอลัมน์ `role` — ผู้ดูแลหมู่บ้าน (มีอีเมล+รหัสผ่าน เข้าหลังบ้าน) กับลูกบ้าน
--   (มีแค่เบอร์ ไม่มีรหัสผ่าน ดูได้แค่บิลบ้านตัวเอง) ผลที่ตามมาจริง ๆ คือ:
--
--     1. `GET /admin/all` คืนบัญชีลูกบ้านปนออกไปด้วย เพราะ AdminService.findAll()
--        เรียก find() เปล่า ๆ ไม่ได้กรอง role — รายชื่อ "ผู้ดูแล" จึงมีคนที่ไม่ใช่
--        ผู้ดูแลปนอยู่ และจะปนมากขึ้นเรื่อย ๆ ตามจำนวนลูกบ้านที่เคยล็อกอิน
--     2. unique key บน `email` / `phone` ถูกใช้ร่วมกันสองความหมาย เบอร์ของลูกบ้าน
--        จองที่ในสเปซเดียวกับเบอร์ของผู้ดูแล ทั้งที่เป็นคนละทะเบียน
--     3. คอลัมน์ครึ่งตารางว่างเสมอสำหรับอีกฝั่ง (ลูกบ้านไม่มี email/password/photo)
--     4. ใครก็ตามที่ UPDATE role ผิดหนึ่งครั้ง = ลูกบ้านกลายเป็นผู้ดูแลทันที
--        ด่านทั้งระบบยืนอยู่บนค่าในคอลัมน์เดียวที่แก้ได้ด้วย UPDATE ธรรมดา
--
--   หลังแยกแล้ว "เป็นผู้ดูแลไหม" ตอบด้วย **ตารางที่บัญชีนั้นอยู่** ไม่ใช่ค่าในคอลัมน์
--
-- ⚠️ id ถูกยกมาทั้งค่าเดิม (INSERT ... SELECT id, ...) ตั้งใจให้ตรงกัน เพราะ
--    JWT ที่ออกไปแล้วเก็บ account id ไว้ใน `sub` และ token มีอายุ 1 วัน
--    ถ้าแจกเลขใหม่ ลูกบ้านที่ล็อกอินค้างไว้จะกระโดดไปเห็นบ้านของบัญชีอื่นทันที
--    (`account_members.account_id` เก็บเลขเดิมอยู่) — อันตรายกว่าการถูกเด้งออก
--
-- ⚠️ ไฟล์นี้ลบคอลัมน์ `admin.role` ทิ้งด้วย หลังแยกตารางแล้วค่าที่เป็นไปได้
--    เหลืออย่างเดียวคือ 'admin' คอลัมน์ที่มีค่าเดียวตลอดไม่ได้บอกอะไร แต่ยัง
--    เปิดช่องให้ตั้งผิดได้อยู่ ฝั่ง NestJS เปลี่ยนไปกำหนด role จากตารางที่ล็อกอินแทน
--    (ดู AuthService.login / loginMember)
--
-- ⚠️ ต้องขึ้นพร้อมโค้ดฝั่ง NestJS — AccountEntity, AuthService, AdminEntity
--    ที่ตัดฟิลด์ role ออก แยกกันขึ้นไม่ได้
-- =====================================================================

-- requires: migrate-member-accounts.sql, migrate-reports.sql, migrate-admin-role.sql,
-- requires: migrate-utf8mb4.sql

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ตารางบัญชีลูกบ้าน
--
--    ไม่มีคอลัมน์ password โดยตั้งใจ — ลูกบ้านเข้าด้วยเบอร์อย่างเดียว
--    (ตัดสินใจไว้แล้วใน AuthService.loginMember) คอลัมน์ที่ไม่มีวันถูกใช้
--    ไม่ควรมีอยู่ให้คนรุ่นหลังเดาว่ามันควรถูกใช้
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `accounts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `phone` varchar(20) NOT NULL COMMENT 'เบอร์ที่ใช้เข้าระบบ = ชื่อผู้ใช้ของลูกบ้าน',
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_accounts_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 2) ย้ายบัญชีลูกบ้านมา คงเลข id เดิมไว้ทุกแถว (ดูคำเตือนหัวไฟล์)
--    IGNORE เพื่อให้รันซ้ำได้ — แถวที่ย้ายมาแล้วจะถูกข้าม ไม่ใช่ทับ
-- ─────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `accounts` (`id`, `phone`, `create_date`)
SELECT `id`, `phone`, `create_date`
FROM `admin`
WHERE `role` = 'member' AND `phone` IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3) ย้าย FK ของตารางที่ชี้มาที่บัญชี — จาก admin.id ไป accounts.id
--
--    ค่าที่เก็บอยู่ไม่ต้องแก้เลยสักแถว เพราะข้อ 2 คงเลข id ไว้เหมือนเดิม
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `account_members` DROP FOREIGN KEY IF EXISTS `fk_account_members_admin1`;
ALTER TABLE `account_members`
  ADD CONSTRAINT `fk_account_members_accounts`
    FOREIGN KEY IF NOT EXISTS (`account_id`) REFERENCES `accounts` (`id`);

ALTER TABLE `reports` DROP FOREIGN KEY IF EXISTS `fk_reports_admin1`;
ALTER TABLE `reports`
  ADD CONSTRAINT `fk_reports_accounts`
    FOREIGN KEY IF NOT EXISTS (`account_id`) REFERENCES `accounts` (`id`);

-- ─────────────────────────────────────────────────────────────────────
-- 4) เอาบัญชีลูกบ้านออกจากตาราง admin
--
--    ทำหลังย้าย FK แล้วเท่านั้น — ถ้าลบก่อน FK เดิมจะกันไม่ให้ลบ (มีแถวอ้างอยู่)
--    ซึ่งก็คือด่านที่ทำให้ลำดับนี้ผิดไม่ได้อยู่แล้ว
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM `admin` WHERE `role` = 'member';

-- ─────────────────────────────────────────────────────────────────────
-- 5) ทิ้งคอลัมน์ role — ตารางนี้เหลือแต่ผู้ดูแลแล้ว (ดูคำเตือนหัวไฟล์)
--    admin_role (owner/staff) เป็นคนละเรื่องและยังอยู่เหมือนเดิม
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `admin` DROP COLUMN IF EXISTS `role`;

-- ─────────────────────────────────────────────────────────────────────
-- ตรวจผลลัพธ์
-- ─────────────────────────────────────────────────────────────────────
SELECT 'accounts' AS `table`, COUNT(*) AS `rows` FROM `accounts`
UNION ALL
SELECT 'admin', COUNT(*) FROM `admin`;

-- FK ของบัญชีต้องชี้ไป accounts ทั้งสองเส้น
SELECT `TABLE_NAME`, `CONSTRAINT_NAME`, `COLUMN_NAME`, `REFERENCED_TABLE_NAME`
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME = 'account_id'
  AND REFERENCED_TABLE_NAME IS NOT NULL;
