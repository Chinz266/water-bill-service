-- =====================================================================
-- รัดคอลัมน์ที่โค้ดถือว่า "ต้องมีค่าเสมอ" ให้เป็น NOT NULL จริง ๆ ใน DB
--
-- ทำไม:
--
--   ดัมป์รุ่นแรกประกาศเกือบทุกคอลัมน์เป็น NULL ได้ แต่ entity ฝั่ง NestJS
--   ประกาศเป็นชนิดที่ไม่มี null (`total_amount!: number` ไม่ใช่ `number | null`)
--   ช่องว่างนี้เจ็บสองทาง:
--
--     1. DB ไม่ช่วยจับเลย ถ้ามีเส้นทางไหนลืมใส่ค่า แถวนั้นจะถูกเขียนเป็น NULL
--        เงียบ ๆ แล้วไปโผล่ทีหลังเป็น "บิลยอด null" หรือ "หน้าเว็บขึ้นว่าง ๆ"
--     2. ชนิดใน TypeScript โกหก — โค้ดที่อ่านค่าไปคำนวณต่อไม่ต้องเช็ค null
--        เพราะ type บอกว่าไม่มีทางเป็น null ทั้งที่ DB ยอมให้เป็นได้
--
--   คอลัมน์ในไฟล์นี้คือคอลัมน์ที่ "ถ้าเป็น NULL แปลว่ามีบั๊ก" ทั้งหมด — ยอดเงิน,
--   หน่วยน้ำ, รอบบิล, สถานะ, ชื่อหมู่บ้าน ไม่ใช่ข้อมูลที่ปล่อยว่างได้ตามธรรมชาติ
--
-- ⚠️ ตรวจข้อมูลจริงก่อนเขียนไฟล์นี้แล้ว: ทุกคอลัมน์ที่รัดไม่มีแถว NULL ค้างอยู่เลย
--    (bills / meter_readings / villages ยังว่าง, water_rates มี 1 แถวและครบ)
--    ถ้าเอาไปรันกับฐานที่มีข้อมูลค้าง MySQL จะเปลี่ยน NULL เป็นค่าว่าง/0 ให้เงียบ ๆ
--    **ต้องไล่เติมค่าที่ถูกก่อนรัน** — คิวรีตรวจอยู่ท้ายไฟล์
--
-- ─────────────────────────────────────────────────────────────────────
-- ที่ตั้งใจ "ไม่" รัด:
--
--   bills.modify_date / villages.modify_date — NULL แปลว่า "ยังไม่เคยมีคนแก้"
--     ซึ่งเป็นข้อมูลจริง ไม่ใช่ค่าที่หายไป (entity ใช้ @UpdateDateColumn ที่ประกาศ
--     เป็น non-null อยู่ ตรงนี้ entity เป็นฝ่ายพูดเกินจริง ไม่ใช่ DB ผิด)
--
--   bills.create_by / meter_readings.create_by — เป็น NOT NULL อยู่แล้ว ส่วน DTO
--     ที่ประกาศเป็น optional ถูกแก้ที่ controller แทน (อ่านจาก token เสมอ)
--
--   subdistricts.name_in_english — มี 271 แถวที่เป็น NULL จริงในข้อมูลตำบล
--     ฝั่งที่ผิดคือ entity จึงแก้ที่ entity ให้เป็น nullable ไม่ใช่มารัด DB
-- =====================================================================

-- ต้องมาหลังไฟล์ที่ยังแตะคอลัมน์เหล่านี้อยู่ (เปลี่ยนชนิด/เปลี่ยนชื่อ)
-- requires: migrate-column-typos.sql, migrate-utf8mb4.sql, migrate-bill-audit.sql

-- ฐานข้อมูลมาจาก DB_DATABASE ใน .env (ตัวรันเลือกให้ตอนต่อ) — ไฟล์นี้จึงไม่ USE เอง
-- รันด้วยมือใน phpMyAdmin/CLI ต้องเลือกฐานข้อมูลก่อน

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────
-- 1) บิล — ยอดเงินและหน่วยน้ำที่เป็น NULL คือบิลที่ใช้ไม่ได้
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `bills`
  MODIFY COLUMN `previous_unit` int(11) NOT NULL,
  MODIFY COLUMN `current_unit` int(11) NOT NULL,
  MODIFY COLUMN `usage_unit` int(11) NOT NULL,
  MODIFY COLUMN `total_amount` decimal(10,2) NOT NULL,
  MODIFY COLUMN `billing_month` varchar(10) NOT NULL,
  MODIFY COLUMN `billing_year` varchar(10) NOT NULL,
  MODIFY COLUMN `payment_status` enum('Pending','Paid','Overdue')
    NOT NULL DEFAULT 'Pending';

-- ─────────────────────────────────────────────────────────────────────
-- 2) การจดมิเตอร์ — ไม่มีวันจดหรือไม่มีเลข ก็ไม่ใช่การจด
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `meter_readings`
  MODIFY COLUMN `reading_date` date NOT NULL,
  MODIFY COLUMN `meter_unit` int(11) NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3) หมู่บ้าน — ชื่อ/หมู่ที่/รอบบิล เป็นของที่ต้องกรอกตั้งแต่สร้าง
--    billing_month มี default อยู่แล้วฝั่ง entity ('EVERY_MONTH') ใส่ให้ตรงกัน
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `villages`
  MODIFY COLUMN `village_name` varchar(200) NOT NULL,
  MODIFY COLUMN `village_no` varchar(45) NOT NULL,
  MODIFY COLUMN `billing_month` varchar(45) NOT NULL DEFAULT 'EVERY_MONTH';

-- ─────────────────────────────────────────────────────────────────────
-- 4) เรทค่าน้ำ — ราคาต่อหน่วยที่เป็น NULL ทำให้คิดเงินไม่ได้ทั้งระบบ
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `water_rates`
  MODIFY COLUMN `price_per_unit` decimal(10,2) NOT NULL,
  MODIFY COLUMN `status` enum('Active','Inactive') NOT NULL DEFAULT 'Active';

-- ─────────────────────────────────────────────────────────────────────
-- ตรวจก่อนรัน (ถ้าฐานมีข้อมูลอยู่) — ทุกช่องต้องเป็น 0 ไม่งั้นต้องเติมค่าก่อน
-- ─────────────────────────────────────────────────────────────────────
SELECT
  SUM(`previous_unit` IS NULL) AS previous_unit,
  SUM(`current_unit` IS NULL) AS current_unit,
  SUM(`usage_unit` IS NULL) AS usage_unit,
  SUM(`total_amount` IS NULL) AS total_amount,
  SUM(`billing_month` IS NULL) AS billing_month,
  SUM(`billing_year` IS NULL) AS billing_year,
  SUM(`payment_status` IS NULL) AS payment_status
FROM `bills`;
