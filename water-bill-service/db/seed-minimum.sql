-- =====================================================================
-- Seed ข้อมูลขั้นต่ำ เพื่อให้ "สร้างบิล" จากหน้าบ้านทำงานได้
-- หน้าบ้าน (meter-reading.service.ts -> saveBill) ส่ง:
--   meter_readings_id = 1, water_rates_id = 1, create_by = 1
-- ทั้ง 3 ค่านี้ต้องมีอยู่จริงใน DB เพราะติด Foreign Key
--
-- ⚠️ ลำดับการรัน:
--   1. import โครงสร้าง db/water-bill-db.sql ให้เรียบร้อยก่อน
--   2. รัน  npm run seed:admin   <-- สร้าง admin id=1 + migrate คอลัมน์ email/create_date ให้ตาราง admin
--      (ห้าม INSERT admin ในไฟล์นี้ เพราะ seed:admin ทำให้ admin.email เป็น NOT NULL)
--   3. ค่อยรันไฟล์นี้:
--        mysql -u root water-bill-db < db/seed-minimum.sql
--        หรือ import ผ่าน phpMyAdmin -> เลือกฐานข้อมูล water-bill-db -> Import
-- =====================================================================

USE `water-bill-db`;

-- 🌟 บังคับ charset ของ connection เป็น utf8mb4 ก่อนเสมอ
--    ถ้าไม่ตั้ง ไคลเอนต์บน Windows จะ default เป็น tis620/cp874 แล้วภาษาไทยจะถูกเข้ารหัสซ้อนสองชั้น
--    เก็บลง DB เป็น "เธชเธกเธเธฒเธข" แทน "สมชาย" (ซึ่งต้องมาไล่แปลงกลับทีหลัง)
SET NAMES utf8mb4;

-- หมายเหตุ: admin id=1 มาจาก `npm run seed:admin` (ดูขั้นตอนด้านบน) จึงไม่ insert ซ้ำที่นี่

-- 2) หมู่บ้าน (members.villages_id -> villages.id) ใช้ province/district/subdistrict id=1 ที่มีข้อมูลอยู่แล้ว
INSERT INTO `villages`
  (`id`, `provinces_id`, `districts_id`, `subdistricts_id`, `village_name`, `village_no`,
   `headman_name`, `deputy_headman_name`, `phone`, `billing_month`, `craeta_date`, `create_by`)
VALUES
  (1, 1, 1, 1, 'หมู่บ้านทดสอบ', '1', 'ผู้ใหญ่บ้าน', 'รองผู้ใหญ่บ้าน', '0810000000', 'EVERY_MONTH', CURDATE(), 1)
ON DUPLICATE KEY UPDATE `village_name` = VALUES(`village_name`);

-- 3) เรทค่าน้ำ (bills.water_rates_id = 1 -> water_rates.id) *** ตัวที่ทำให้เกิด 404 "ไม่พบข้อมูลเรทค่าน้ำ" ***
INSERT INTO `water_rates`
  (`id`, `price_per_unit`, `status`, `updated_at`, `create_date`, `create_by`)
VALUES
  (1, 10.00, 'Active', NOW(), CURDATE(), 1)
ON DUPLICATE KEY UPDATE `price_per_unit` = VALUES(`price_per_unit`);

-- 4) ลูกบ้าน (meter_readings.members_id1 -> members.id)
INSERT INTO `members`
  (`id`, `fname`, `lname`, `house_no`, `phone`, `villages_id`, `craeta_date`, `craete_by`)
VALUES
  (1, 'สมชาย', 'ใจดี', '99/1', '0890000000', 1, CURDATE(), 1)
ON DUPLICATE KEY UPDATE `fname` = VALUES(`fname`);

-- 5) การจดมิเตอร์ (bills.meter_readings_id = 1 -> meter_readings.id)
INSERT INTO `meter_readings`
  (`id`, `reading_date`, `meter_unit`, `members_id1`, `creat_date`, `create_by`)
VALUES
  (1, CURDATE(), 1200, 1, CURDATE(), 1)
ON DUPLICATE KEY UPDATE `meter_unit` = VALUES(`meter_unit`);
