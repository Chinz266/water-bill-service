-- =====================================================================
-- กลุ่มมิเตอร์ที่ติดกัน (cluster) + ลำดับตำแหน่งจริงบนกำแพง (sequence_index)
--
-- ═══ ปัญหาที่แก้ ═══
--
-- ทาวน์โฮม/ห้องเช่าเอามิเตอร์มาเรียงติดกันบนกำแพงเดียวกัน ห่างกันราว 30 ซม.
-- ขณะที่ GPS มือถือคลาดเคลื่อน 3-5 ม. ในที่โล่ง และ 10-30 ม. ใต้ชายคา/ระหว่างตึก
-- ความคลาดเคลื่อนกว้างกว่าระยะห่างจริงเป็นสิบเท่า พิกัดจึงแยก "ตัวซ้าย/ตัวขวา"
-- ไม่ได้เลยไม่ว่าจะปรับรัศมีเป็นเท่าไหร่ — ไม่ใช่ปัญหาการตั้งค่า แต่เป็นเพดานของเครื่องมือ
--
-- ทางแก้คือเลิกถามพิกัดสำหรับมิเตอร์กลุ่มนี้ แล้วใช้ "ตำแหน่งตายตัวที่จดไว้ล่วงหน้า"
-- ซึ่งไม่แกว่งตามสัญญาณ: ตัวซ้ายสุดคือบ้านไหน ตัวถัดไปคือบ้านไหน
--
-- ═══ ความหมายของสองคอลัมน์ ═══
--
--   cluster_group_id  ป้ายชื่อของกลุ่มมิเตอร์ที่ติดกันหนึ่งกลุ่ม (เช่น 'WALL-206')
--                     NULL = บ้านเดี่ยวที่มิเตอร์อยู่ของตัวเอง ไม่ต้องใช้ระบบลำดับ
--                     และทุกอย่างทำงานเหมือนเดิมทุกประการ
--
--   sequence_index    ตำแหน่งกายภาพในกลุ่ม เรียงจากซ้ายไปขวา "เมื่อยืนหันหน้าเข้าหากำแพง"
--                     1 = ซ้ายสุด, 2, 3, ... , ตัวท้าย = ขวาสุด
--
-- ⚠️ ทิศทางที่ยืนต้องเป็นข้อตกลงเดียวทั้งหมู่บ้าน ไม่งั้นซ้าย/ขวาจะกลับด้าน
--    ระหว่างคนที่มากรอกข้อมูลกับคนที่ไปเดินจด — เขียนไว้ที่ป้ายหน้ากลุ่มมิเตอร์ด้วยยิ่งดี
--
-- ═══ ทำไม unique (cluster_group_id, sequence_index) ═══
--
-- ตำแหน่งซ้ำในกลุ่มเดียวกัน = ลำดับกำกวม ซึ่งทำลายทั้งการนำทางบนแอปและด่านหลังบ้าน
-- (MySQL ยอมให้ NULL ซ้ำได้หลายแถวใน unique index — บ้านเดี่ยวจึงไม่ติดด่านนี้)
--
-- รันคำสั่งนี้ครั้งเดียว:
--   npm run migrate -- db/migrate-meter-clusters.sql
-- =====================================================================

USE `water-bill-db`;

SET NAMES utf8mb4;

ALTER TABLE `members`
  ADD COLUMN `cluster_group_id` varchar(45) DEFAULT NULL
    COMMENT 'กลุ่มมิเตอร์ที่ติดกันจน GPS แยกไม่ออก (NULL = บ้านเดี่ยว ใช้พิกัดได้ตามปกติ)'
    AFTER `villages_id`,
  ADD COLUMN `sequence_index` tinyint unsigned DEFAULT NULL
    COMMENT 'ตำแหน่งในกลุ่ม เรียงซ้าย→ขวาเมื่อหันหน้าเข้าหากำแพง (1 = ซ้ายสุด)'
    AFTER `cluster_group_id`;

-- ค้นหาบ้านทั้งกลุ่มด้วยคิวรีเดียว (ใช้ทั้งตอนออกบิลและตอนแอปล็อกลำดับ)
ALTER TABLE `members`
  ADD KEY `idx_members_cluster` (`cluster_group_id`);

-- ตำแหน่งห้ามซ้ำในกลุ่มเดียวกัน — ลำดับกำกวมแปลว่าไม่มีอะไรมาแทน GPS ได้เลย
ALTER TABLE `members`
  ADD UNIQUE KEY `uq_members_cluster_sequence` (`cluster_group_id`, `sequence_index`);

-- ═══ ตัวอย่างการกรอก (แก้บ้านเลขที่ให้ตรงกับหน้างานก่อนรัน) ═══
--
-- UPDATE `members` SET `cluster_group_id` = 'WALL-206', `sequence_index` = 1 WHERE `house_no` = '206/1';
-- UPDATE `members` SET `cluster_group_id` = 'WALL-206', `sequence_index` = 2 WHERE `house_no` = '206/2';
-- UPDATE `members` SET `cluster_group_id` = 'WALL-206', `sequence_index` = 3 WHERE `house_no` = '206/3';

-- ไล่ดูว่ากลุ่มไหนกรอกครบแล้ว และมีบ้านไหนที่ตั้งกลุ่มแต่ลืมใส่ลำดับ (ต้องไม่มี)
SELECT
  `cluster_group_id`,
  COUNT(*) AS `houses`,
  SUM(`sequence_index` IS NULL) AS `missing_sequence`,
  GROUP_CONCAT(CONCAT(`sequence_index`, ':', `house_no`) ORDER BY `sequence_index`) AS `order_left_to_right`
FROM `members`
WHERE `cluster_group_id` IS NOT NULL
GROUP BY `cluster_group_id`
ORDER BY `cluster_group_id`;
