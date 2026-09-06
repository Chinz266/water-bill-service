-- =====================================================================
-- ทำให้ตาราง `admin` ในดัมป์ตามทัน AdminEntity
--
-- ดัมป์ `db/water-bill-db.sql` เป็นรุ่นแรกสุดของโปรเจกต์ ตาราง `admin` ในนั้น
-- มีแค่ 6 คอลัมน์ (id / fname / lname / phone / password / role) ขาดของที่โค้ด
-- ใช้จริงไปอีก 5 ตัว และ `password` ยังเป็น varchar(45) ซึ่งสั้นกว่า bcrypt hash
--
-- ทำไมย้ายมาเป็น migration:
--
--   เดิมงานนี้ซ่อนอยู่ใน `npm run seed:admin` (ฟังก์ชัน ensureAdminSchema) ซึ่งเป็น
--   สคริปต์ "สร้างข้อมูลตั้งต้น" ไม่ใช่ "แก้ schema" ผลคือลำดับการติดตั้งกลายเป็นวงกลม:
--   migration ต้องการคอลัมน์ที่ seed เป็นคนเติม แต่ seed ใช้ TypeORM repository
--   ซึ่งอ่าน `admin_role` ที่ migration เป็นคนเพิ่ม — รันทางไหนก่อนก็พัง
--
--   ย้ายมาไว้ที่นี่แล้ว การตั้งเครื่องใหม่จึงเดินทางเดียวจบ: ดัมป์ -> migration -> seed
--   และ `seed:admin` เหลือหน้าที่เดียวคือสร้างบัญชีแอดมิน
--
-- ⚠️ `password` ต้องยาว 255 — bcrypt hash ยาว 60 ตัว ถ้าปล่อยไว้ที่ 45 MySQL จะตัด
--    hash ทิ้งเงียบ ๆ แล้วบัญชีนั้นล็อกอินไม่ผ่านตลอดกาลโดยไม่มี error ให้เห็น
--
-- รันซ้ำได้: ใช้ IF NOT EXISTS ของ MariaDB ทุกคำสั่ง
-- =====================================================================

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) คอลัมน์ที่ขาด
--
--    email เป็น NULL ได้ตั้งแต่แรก ไม่ต้องบังคับ NOT NULL แล้วมาคลายทีหลัง —
--    migrate-member-accounts.sql คลายให้อยู่ดี เพราะบัญชีที่ล็อกอินด้วยเบอร์ไม่มีอีเมล
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `admin`
  ADD COLUMN IF NOT EXISTS `email` varchar(100) DEFAULT NULL AFTER `lname`,
  -- รูปโปรไฟล์เก็บเป็น base64 data URL (ย่อจากฝั่งเว็บแล้ว) varchar สั้นเกินเก็บไม่พอ
  ADD COLUMN IF NOT EXISTS `photo` mediumtext DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `create_date` datetime DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `create_by` int(11) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `modify_by` int(11) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `modify_date` datetime DEFAULT NULL;

-- แถวเก่าที่ยังไม่มีวันสร้าง ให้ถือว่าสร้างตอนรัน migration นี้
UPDATE `admin` SET `create_date` = NOW() WHERE `create_date` IS NULL;

ALTER TABLE `admin` MODIFY COLUMN `create_date` datetime NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2) ขยาย password ให้พอกับ bcrypt hash (ดูคำเตือนหัวไฟล์)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `admin` MODIFY COLUMN `password` varchar(255) DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3) อีเมลห้ามซ้ำ — เป็นชื่อผู้ใช้ของฝั่งผู้ดูแล
--    (MySQL นับ NULL แต่ละแถวเป็นคนละค่า แถวที่ยังไม่มีอีเมลจึงอยู่ร่วมกันได้)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `admin` ADD UNIQUE INDEX IF NOT EXISTS `IDX_admin_email` (`email`);

-- ─────────────────────────────────────────────────────────────────────
-- ตรวจผลลัพธ์ — ควรเห็นครบ 5 คอลัมน์ และ password เป็น varchar(255)
-- ─────────────────────────────────────────────────────────────────────
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'admin'
  AND COLUMN_NAME IN
    ('email', 'password', 'create_date', 'create_by', 'modify_by', 'modify_date');
