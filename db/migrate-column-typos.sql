-- =====================================================================
-- แก้ชื่อคอลัมน์ที่สะกดผิดติดมาตั้งแต่ dump รุ่นแรก
--
--   members.craeta_date        -> create_date
--   members.craete_by          -> create_by
--   villages.craeta_date       -> create_date
--   meter_readings.creat_date  -> create_date
--   meter_readings.members_id1 -> members_id
--
-- ทำไมต้องแก้:
--
--   ชื่อพวกนี้ไม่ได้แค่ดูไม่สวย — มันบังคับให้ทุกที่ที่แตะคอลัมน์ต้องจำข้อยกเว้น
--   entity ต้องเขียน @Column({ name: 'craeta_date' }) กำกับ, query builder ต้อง
--   เขียน `reading.members_id1` ปนกับ `reading.members_id` ในไฟล์เดียวกัน และ
--   ทุกครั้งที่มีคนเขียนโค้ดใหม่ก็ต้องไปเปิดดูก่อนว่าตารางนี้สะกดแบบไหน
--   ต้นทุนนี้จ่ายซ้ำทุกครั้งที่แตะโค้ด ส่วนการแก้จ่ายครั้งเดียว
--
--   `members_id1` เจ็บกว่าเพื่อน เพราะเลข 1 ท้ายชื่ออ่านเหมือน "ลูกบ้านคนที่ 1"
--   ทั้งที่มันคือร่องรอยของเครื่องมือออกแบบ ER ที่ตั้งชื่อซ้ำแล้วเติมเลขให้เอง
--
-- ⚠️ ต้องอัปเดตโค้ดฝั่ง NestJS พร้อมกัน (entity + service ที่อ้างชื่อเก่าใน
--    query builder) ไฟล์นี้กับโค้ดจึงต้องขึ้นไปด้วยกัน แยกกันไม่ได้
--
-- FK สองตัวชี้อยู่ที่คอลัมน์ที่จะเปลี่ยนชื่อ จึงต้องถอดก่อนแล้วผูกกลับ —
-- MariaDB 10.4 เปลี่ยนชื่อคอลัมน์ที่มี FK คาอยู่ตรง ๆ ไม่ได้เสมอไป ทำแบบนี้ชัวร์กว่า
-- (index ที่ครอบคอลัมน์นั้นตามชื่อใหม่ไปเองอัตโนมัติ ไม่ต้องสร้างใหม่)
--
-- รันซ้ำได้: ใช้ IF EXISTS / IF NOT EXISTS ของ MariaDB ทุกคำสั่ง
-- =====================================================================

-- ไฟล์เหล่านี้อ้างชื่อคอลัมน์แบบเก่า จึงต้องรันให้จบก่อนจะเปลี่ยนชื่อ
-- requires: migrate-reading-location.sql, migrate-meter-digits.sql,
-- requires: migrate-meters.sql, migrate-unassigned-readings.sql,
-- requires: migrate-meter-clusters.sql, migrate-longitude-precision.sql

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) ถอด FK ที่คาอยู่บนคอลัมน์ที่จะเปลี่ยนชื่อ
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `members` DROP FOREIGN KEY IF EXISTS `fk_members_admin1`;
ALTER TABLE `meter_readings` DROP FOREIGN KEY IF EXISTS `fk_meter_readings_members1`;

-- ─────────────────────────────────────────────────────────────────────
-- 2) เปลี่ยนชื่อ (ชนิดคอลัมน์คงเดิมทุกตัว เปลี่ยนแค่ชื่อ)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `members`
  CHANGE COLUMN IF EXISTS `craeta_date` `create_date` date NOT NULL,
  CHANGE COLUMN IF EXISTS `craete_by` `create_by` int(11) NOT NULL;

ALTER TABLE `villages`
  CHANGE COLUMN IF EXISTS `craeta_date` `create_date` date NOT NULL;

ALTER TABLE `meter_readings`
  CHANGE COLUMN IF EXISTS `creat_date` `create_date` date NOT NULL,
  CHANGE COLUMN IF EXISTS `members_id1` `members_id` int(11) NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3) ผูก FK กลับ — ชื่อ constraint เดิม เปลี่ยนแค่คอลัมน์ที่อ้างถึง
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `members`
  ADD CONSTRAINT `fk_members_admin1`
    FOREIGN KEY IF NOT EXISTS (`create_by`) REFERENCES `admin` (`id`);

ALTER TABLE `meter_readings`
  ADD CONSTRAINT `fk_meter_readings_members1`
    FOREIGN KEY IF NOT EXISTS (`members_id`) REFERENCES `members` (`id`);

-- ─────────────────────────────────────────────────────────────────────
-- ตรวจผลลัพธ์ — ควรว่างเปล่า (ไม่เหลือชื่อสะกดผิดในฐานข้อมูล)
-- ─────────────────────────────────────────────────────────────────────
SELECT `TABLE_NAME`, `COLUMN_NAME`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND COLUMN_NAME IN ('craeta_date', 'craete_by', 'creat_date', 'members_id1');
