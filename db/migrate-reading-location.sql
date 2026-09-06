-- =====================================================================
-- เก็บพิกัดและเวลาที่ถ่ายจริง ลงในทุกครั้งที่จดมิเตอร์
--
-- ทำไมต้องเก็บที่ meter_readings ไม่ใช่แค่ที่ members:
--
--   members.latitude/longitude เป็นค่าที่กรอกครั้งเดียวตอนลงทะเบียน และมักมาจาก
--   การจิ้มหมุดบนแผนที่ (กลางหลังคา) ขณะที่ตอนจดมิเตอร์พนักงานยืนอยู่ที่ตัวมิเตอร์
--   (ริมรั้ว ห่างจากกลางบ้าน 10-15 ม.) เอาสองค่านี้มาเทียบกันจึงมีความคลาดเคลื่อน
--   แบบคงที่ติดอยู่ทุกบ้านทุกเดือน ซึ่งใหญ่พอ ๆ กับระยะห่างระหว่างบ้าน (8-20 ม.)
--   → แยกบ้านไม่ออก
--
--   พอเก็บพิกัดของ "ทุกครั้งที่จด" ไว้ ระบบจะเรียนรู้ได้เองว่าจุดที่พนักงานยืนถ่าย
--   มิเตอร์ของบ้านหลังนี้จริง ๆ อยู่ตรงไหน (ใช้ค่ามัธยฐานของหลายเดือน)
--   ทั้งจุดอ้างอิงและจุดที่วัดมาจากเซนเซอร์เดียวกัน ยืนที่เดียวกัน ความคลาดเคลื่อน
--   แบบคงที่จึงหักล้างกันเอง เหลือแต่ error สุ่มที่เฉลี่ยทิ้งได้
--
-- captured_at เก็บ "เวลาที่กดชัตเตอร์" ซึ่งต่างจาก reading_date ที่เป็นแค่วันที่
-- (คอลัมน์ date ไม่มีเวลา) ใช้จับเคสรูปเก่าถูกเอามาใช้ซ้ำข้ามเดือน
--
-- ⚠️ longitude ต้องเป็น decimal(11,8) ไม่ใช่ (10,8) — ลองจิจูดไทย 97-106
--    มี 3 หลักหน้าจุด ดู db/migrate-longitude-precision.sql
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-reading-location.sql
-- =====================================================================

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

ALTER TABLE `meter_readings`
  ADD COLUMN `latitude` decimal(10,8) DEFAULT NULL
    COMMENT 'ละติจูดของจุดที่ถ่ายรูปมิเตอร์ (จาก EXIF หรือ Geolocation API)' AFTER `evidence_photo`,
  ADD COLUMN `longitude` decimal(11,8) DEFAULT NULL
    COMMENT 'ลองจิจูดของจุดที่ถ่ายรูป (11,8 เพราะลองจิจูดไทยมี 3 หลักหน้าจุด)' AFTER `latitude`,
  ADD COLUMN `gps_accuracy_m` int(11) DEFAULT NULL
    COMMENT 'ความคลาดเคลื่อนของพิกัดเป็นเมตร — Geolocation API มีให้ EXIF ไม่มี (NULL)' AFTER `longitude`,
  ADD COLUMN `captured_at` datetime DEFAULT NULL
    COMMENT 'วันเวลาที่กดชัตเตอร์จริง (reading_date เป็น date ไม่มีเวลา)' AFTER `gps_accuracy_m`;

-- คิวรีหาพิกัดอ้างอิงของแต่ละบ้านจากที่จดมาแล้ว ใช้ตรวจว่าเก็บข้อมูลได้จริงไหม
SELECT
  `members_id1`                        AS members_id,
  COUNT(`latitude`)                    AS readings_with_gps,
  ROUND(AVG(`latitude`), 8)            AS avg_latitude,
  ROUND(AVG(`longitude`), 8)           AS avg_longitude
FROM `meter_readings`
WHERE `latitude` IS NOT NULL
GROUP BY `members_id1`
ORDER BY `members_id1`;
