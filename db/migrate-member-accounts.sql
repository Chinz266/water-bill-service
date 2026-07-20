-- =====================================================================
-- เพิ่มระบบล็อกอินสำหรับ "ลูกบ้าน" (แยกจาก admin)
--
-- แนวคิด: ใช้ตาราง `admin` เดิมเป็นตารางบัญชีร่วม (accounts) แยกด้วย role
--   - role='admin'  ล็อกอินด้วยอีเมล เห็น/จัดการได้ทุกอย่าง
--   - role='member' ล็อกอินด้วยเบอร์โทร เห็นเฉพาะบิลของบ้านตัวเอง
--
-- 1 เบอร์โทรอาจผูกได้หลายบ้าน (พบจริงในข้อมูล: 0822222222 ผูกกับ
-- 99/1 และ 99/1/2) จึงต้องมีตารางเชื่อมแบบ many-to-many แทนการฝัง
-- members_id คอลัมน์เดียวใน admin
--
-- รันคำสั่งนี้ครั้งเดียว:
--   mysql -u root water-bill-db < db/migrate-member-accounts.sql
-- =====================================================================

USE `water-bill-db`;

-- บัญชีลูกบ้านไม่มีอีเมล จึงต้องยอมให้ email เป็น NULL ได้
-- (UNIQUE KEY เดิมบน email ไม่กระทบ เพราะ MySQL นับ NULL แต่ละแถวเป็นค่าต่างกันเสมอ)
ALTER TABLE `admin` MODIFY COLUMN `email` varchar(100) NULL;

-- เบอร์โทรคือ "username" ของบัญชีลูกบ้าน ต้องไม่ซ้ำกันระหว่างบัญชี
-- (คนละเรื่องกับ members.phone ที่เป็นเบอร์ติดต่อของบ้าน ซึ่งซ้ำกันได้)
ALTER TABLE `admin` ADD UNIQUE INDEX `IDX_admin_phone` (`phone`);

-- ตารางเชื่อมบัญชี ↔ บ้าน: 1 บัญชีเห็นได้หลายบ้าน, 1 บ้านมีได้หลายบัญชีดูแล
CREATE TABLE IF NOT EXISTS `account_members` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `account_id` int(11) NOT NULL,
  `members_id` int(11) NOT NULL,
  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_account_member_unique` (`account_id`, `members_id`),
  KEY `fk_account_members_admin1_idx` (`account_id`),
  KEY `fk_account_members_members1_idx` (`members_id`),
  CONSTRAINT `fk_account_members_admin1` FOREIGN KEY (`account_id`) REFERENCES `admin` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_account_members_members1` FOREIGN KEY (`members_id`) REFERENCES `members` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
