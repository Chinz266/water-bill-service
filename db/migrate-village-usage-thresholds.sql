-- =====================================================================
-- เกณฑ์ "หน่วยน้ำผิดปกติ" ตั้งค่าได้รายหมู่บ้าน + ด่านเตือนชั้นที่สอง
--
-- ═══ ทำไมต้องมีสองชั้น ═══
--
-- เกณฑ์เดียวตั้งไว้ต่ำ (เช่น 1.5-2 เท่าของค่าปกติ) จะเด้งเกือบทุกเดือนในหน้าร้อน
-- หรือเดือนที่มีคนมาพัก แล้วเจ้าหน้าที่จะกดยืนยันจนเป็นนิสัย — ด่านที่ถูกกดผ่าน
-- ทุกใบไม่ต่างจากไม่มีด่าน และวันที่เลขผิดจริงก็จะถูกกดผ่านไปด้วยแรงเฉื่อยเดียวกัน
--
-- แยกเป็นสองระดับแทน:
--   usage_warn_ratio  (ค่ากลาง 2.0) → แค่ติดธง usage_warning ไม่ต้องกดอะไร
--                                      เอาไว้ไล่ดูย้อนหลังว่าบ้านไหนใช้น้ำขยับ
--   usage_spike_ratio (ค่ากลาง 5.0) → 409 ต้องกด confirm_high_usage
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-village-usage-thresholds.sql
-- =====================================================================

USE `water-bill-db`;

SET NAMES utf8mb4;

ALTER TABLE `villages`
  ADD COLUMN `usage_warn_ratio` decimal(3,1) DEFAULT NULL
    COMMENT 'เกินค่าปกติกี่เท่าจึงติดธงเตือน (NULL = ใช้ค่ากลาง 2.0 ไม่บล็อก)'
    AFTER `payment_due_days`,
  ADD COLUMN `usage_spike_ratio` decimal(3,1) DEFAULT NULL
    COMMENT 'เกินค่าปกติกี่เท่าจึงต้องกดยืนยัน (NULL = ใช้ค่ากลาง 5.0)'
    AFTER `usage_warn_ratio`,
  ADD COLUMN `usage_spike_floor` smallint unsigned DEFAULT NULL
    COMMENT 'ต่ำกว่ากี่หน่วยต่อเดือนไม่ถือว่าผิดปกติแม้เกินอัตราส่วน (NULL = ใช้ค่ากลาง 50)'
    AFTER `usage_spike_ratio`;

-- ─────────────────────────────────────────────────────────────────────
-- gps_near_m — รัศมี "ถือว่าถ่ายอยู่ที่บ้านหลังนี้จริง"
--
-- ค่ากลาง 50 ม. มาจาก √(อ้างอิง 20² + ตอนถ่าย 30²) ≈ 36 ม. บวกเผื่อขอบบน
-- หมู่บ้านที่สัญญาณดีเป็นพิเศษ (ที่โล่ง ไม่มีตึกบัง) หดลงได้เพื่อให้ gpsTiebreak
-- ตัดสินได้บ่อยขึ้น ส่วนหมู่บ้านที่มิเตอร์อยู่ใต้ชายคาติดกำแพงต้องปล่อยไว้ค่ากลาง
--
-- ⚠️ อย่าตั้งต่ำกว่า 36 — ต่ำกว่านั้นคือการปฏิเสธคนที่ถ่ายถูกบ้านแล้ว
--    เพราะช่องว่างที่เหลือแคบกว่าความคลาดเคลื่อนของการวัดเอง
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE `villages`
  ADD COLUMN `gps_near_m` smallint unsigned DEFAULT NULL
    COMMENT 'รัศมีที่ถือว่าถ่ายอยู่ที่บ้านหลังนี้จริง (NULL = ใช้ค่ากลาง 50, ห้ามต่ำกว่า 36)'
    AFTER `meter_pitch_m`;

-- ตรวจผลลัพธ์
SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'water-bill-db' AND TABLE_NAME = 'villages'
  AND COLUMN_NAME IN ('usage_warn_ratio', 'usage_spike_ratio', 'usage_spike_floor', 'gps_near_m');
