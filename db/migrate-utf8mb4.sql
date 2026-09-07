-- =====================================================================
-- รวม charset/collation ของทุกตารางให้เป็น utf8mb4_unicode_ci ชุดเดียว
--
-- ทำไมต้องทำ:
--
--   ตารางที่มาจาก dump รุ่นแรก (admin, bills, members, meter_readings,
--   villages, water_rates, provinces, districts, subdistricts) เป็น
--   `utf8_general_ci` ส่วนตารางที่เพิ่มทีหลังเป็น `utf8mb4_*` ปนกันสองแบบ
--
--   `utf8` ของ MySQL/MariaDB เก็บได้แค่ 3 ไบต์ต่อตัวอักษร — อีโมจิและอักขระ
--   นอก BMP เก็บไม่ได้เลย ข้อความที่ลูกบ้านพิมพ์มาใน reports จึงเก็บได้ครบ
--   (ตารางนั้นเป็น utf8mb4 อยู่แล้ว) แต่ชื่อบ้าน/หมายเหตุที่พิมพ์ลงตารางเก่า
--   จะถูกตัดทิ้งหรือขึ้น error 1366 เงียบ ๆ
--
--   ปัญหาที่ชนบ่อยกว่าคือ JOIN ข้ามตารางด้วยคอลัมน์ตัวอักษร ระหว่างตาราง
--   คนละ collation → MySQL โยน "Illegal mix of collations" ทันที ซึ่งเป็น
--   ระเบิดเวลาที่รอวันมีคนเขียนคิวรีเส้นนั้น ไม่ใช่บั๊กที่มองเห็นตอนนี้
--
--   เลือก `unicode_ci` ไม่ใช่ `general_ci` เพราะเรียง/เทียบภาษาไทยได้ตรงกว่า
--   และเป็นค่าที่ตารางใหม่สุด (account_members, reports) ใช้อยู่แล้ว
--
-- ⚠️ ALTER ทั้งตาราง = MySQL เขียนตารางใหม่ทั้งก้อน ตารางที่อยู่/ตำบล 8,300 แถว
--    ใช้เวลาไม่กี่วินาที แต่ควรรันตอนไม่มีคนใช้งาน
--
-- ปลอดภัยเรื่องความยาว index: ทุกตารางเป็น ROW_FORMAT=Dynamic (จำกัด 3072 ไบต์)
-- ส่วนคอลัมน์ตัวอักษรที่ยาวที่สุดที่มี index คือ schema_migrations.name
-- varchar(191) = 764 ไบต์ใน utf8mb4 ยังห่างเพดานอยู่มาก
--
-- รันซ้ำได้ — ตารางที่เป็น utf8mb4_unicode_ci อยู่แล้วจะถูกเขียนใหม่เฉย ๆ ไม่ error
-- =====================================================================

-- ต้องมาหลังไฟล์ที่สร้างตารางทั้งหมด ไม่งั้นตารางที่เกิดทีหลังจะไม่ถูกแปลง
-- requires: migrate-member-accounts.sql, migrate-reports.sql, migrate-bill-arrears.sql,
-- requires: migrate-meters.sql, migrate-tenancies.sql, migrate-unassigned-readings.sql,
-- requires: migrate-reading-audit.sql, migrate-reading-edit-log.sql, migrate-match-provenance.sql,
-- requires: migrate-review-queue.sql, migrate-meter-clusters.sql

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ตัวฐานข้อมูลเอง — ตารางที่สร้างทีหลังจะได้ default ถูกตั้งแต่แรก
-- ─────────────────────────────────────────────────────────────────────
-- ไม่ระบุชื่อฐานข้อมูล = ใช้ฐานข้อมูลที่ต่ออยู่ (มาจาก DB_DATABASE ใน .env)
ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 2) ตารางที่มาจาก dump รุ่นแรก (utf8_general_ci)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `admin` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `bills` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `members` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `meter_readings` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `villages` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `water_rates` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `provinces` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `districts` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `subdistricts` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- 3) ตารางที่เพิ่มทีหลัง — เป็น utf8mb4 อยู่แล้วแต่ collation ปนกัน
--    (general_ci บ้าง unicode_ci บ้าง) ซึ่งก็ยัง JOIN ข้ามกันไม่ได้เหมือนเดิม
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `account_members` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `reports` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `bill_arrears` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `bill_deletion_logs` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `meters` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `meter_reading_logs` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `reading_flags` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `tenancies` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `unassigned_readings` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `schema_migrations` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────
-- ตรวจผลลัพธ์ — ควรว่างเปล่า (ไม่เหลือตารางที่ collation ไม่ตรง)
-- ─────────────────────────────────────────────────────────────────────
SELECT `TABLE_NAME`, `TABLE_COLLATION`
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_COLLATION <> 'utf8mb4_unicode_ci';
