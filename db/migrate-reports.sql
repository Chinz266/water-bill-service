-- =====================================================================
-- ระบบแจ้งเรื่อง/ร้องเรียน จากลูกบ้าน → ผู้ดูแลหมู่บ้าน
--
-- แนวคิด: 1 แถว = 1 เรื่องที่แจ้ง
--   - ลูกบ้านเลือกหมวด + พิมพ์รายละเอียด + แนบรูปได้ 1 รูป
--   - แอดมินเห็นทุกเรื่อง เปลี่ยนสถานะ และพิมพ์ตอบกลับได้ 1 ครั้ง
--   - ลูกบ้านเห็นเฉพาะเรื่องของบ้านตัวเอง (กรองผ่าน account_members เหมือน /me/bills)
--
-- ⚠️ ต้องรัน db/migrate-member-accounts.sql (สร้าง account_members) ให้เสร็จก่อน
--
-- รันคำสั่งนี้ครั้งเดียว:
--   mysql -u root water-bill-db < db/migrate-reports.sql
-- =====================================================================

USE `water-bill-db`;

-- 🌟 บังคับ charset ของ connection เป็น utf8mb4 ก่อนเสมอ
--    ไม่งั้นภาษาไทยจะถูกเข้ารหัสซ้อนสองชั้น (เก็บเป็น "เธชเธกเธเธฒเธข" แทน "สมชาย")
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,

  -- บ้านที่เรื่องนี้อ้างถึง (แอดมินจะได้รู้ว่าต้องไปดูบ้านหลังไหน)
  `members_id` int(11) NOT NULL,
  -- บัญชีลูกบ้านที่กดส่ง (อ้าง admin.id เพราะ admin เป็นตารางบัญชีร่วม แยกด้วย role)
  `account_id` int(11) NOT NULL,

  `category` varchar(45) NOT NULL COMMENT 'หมวดหมู่เรื่อง เช่น WATER_OUT, WATER_DIRTY, PIPE_LEAK',
  `detail` text NOT NULL COMMENT 'รายละเอียดที่ลูกบ้านพิมพ์เอง',
  -- รูปประกอบเก็บเป็น base64 data URL (ย่อขนาดจากฝั่งเว็บแล้ว) เหมือน admin.photo
  -- MEDIUMTEXT เพราะ varchar สั้นเกินเก็บ base64 ไม่พอ
  `photo` mediumtext DEFAULT NULL,

  `status` enum('Pending','InProgress','Resolved') NOT NULL DEFAULT 'Pending',

  -- คำตอบจากแอดมิน (ตอบได้ครั้งเดียว แก้ทับได้)
  `admin_reply` text DEFAULT NULL,
  `replied_by` int(11) DEFAULT NULL,
  `replied_date` datetime DEFAULT NULL,

  `create_date` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `modify_date` datetime DEFAULT NULL,

  PRIMARY KEY (`id`),
  KEY `fk_reports_members1_idx` (`members_id`),
  KEY `fk_reports_admin1_idx` (`account_id`),
  KEY `fk_reports_admin2_idx` (`replied_by`),
  -- เรียง "ใหม่สุดก่อน" เป็นคิวรีหลักของทั้งสองฝั่ง ใส่ index ไว้ให้ตรงกับการใช้งาน
  KEY `IDX_reports_status_create` (`status`, `create_date`),

  -- บ้านหรือบัญชีถูกลบ → เรื่องที่ผูกอยู่ลบตามไปด้วย (ไม่เหลือเรื่องกำพร้าชี้ไปบ้านที่หายไปแล้ว)
  CONSTRAINT `fk_reports_members1` FOREIGN KEY (`members_id`) REFERENCES `members` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `fk_reports_admin1` FOREIGN KEY (`account_id`) REFERENCES `admin` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  -- แอดมินที่ตอบถูกลบบัญชี → เก็บคำตอบไว้ แค่ไม่รู้ว่าใครตอบ (ห้าม CASCADE ไม่งั้นเรื่องหายยกใบ)
  CONSTRAINT `fk_reports_admin2` FOREIGN KEY (`replied_by`) REFERENCES `admin` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
