# ตั้งค่าฐานข้อมูล

← [กลับหน้าหลัก](../README.md)

## ตั้งทั้งก้อนด้วยคำสั่งเดียว

```powershell
npm run db:setup
```

ทำสี่ขั้นให้ตามลำดับที่ถูก โดยไม่ต้องเปิด phpMyAdmin เลย:

1. สร้าง database ตามชื่อใน `DB_DATABASE` (ถ้ายังไม่มี) เป็น `utf8mb4_unicode_ci` ตั้งแต่แรก
2. import `db/water-bill-db.sql` — schema + ข้อมูลจังหวัด/อำเภอ/ตำบล 8,342 แถว
3. รัน migration ที่ยังไม่ได้รวมเข้าดัมป์ทั้งหมด
4. สร้างแอดมินเริ่มต้นจาก `SEED_ADMIN_*` ใน `.env`

รันซ้ำได้ — ขั้น 2 **ข้ามไปเลยถ้าฐานข้อมูลมีตารางอยู่แล้ว** (ดัมป์มี INSERT ข้อมูลจังหวัด/ตำบล
อยู่ด้วย การ import ทับจะพังที่ primary key ซ้ำกลางทางแล้วทิ้ง schema ค้างครึ่ง ๆ ไว้)
ส่วนขั้น 3 กับ 4 รันซ้ำได้อยู่แล้วโดยตัวมันเอง

⚠️ ไม่มีโหมดล้างฐานข้อมูลทิ้งแล้วสร้างใหม่ **โดยตั้งใจ** — คำสั่งที่ลบข้อมูลจริงได้ไม่ควรอยู่ใน
สคริปต์ที่พิมพ์บ่อย ๆ ถ้าจะเริ่มใหม่ทั้งก้อนให้ `DROP DATABASE` เองใน phpMyAdmin ก่อน

อยากทำทีละขั้นเองก็ยังได้:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\water-bill-db.sql
npm run migrate
npm run seed:admin
```

`synchronize` ถูกตั้งเป็น `false` ใน `src/app.module.ts` และ **ควรปล่อยไว้แบบนั้น** — ดู [known-issues.md](known-issues.md) ว่าเปิดแล้วอันตรายยังไง

---

## Migration — `npm run migrate`

```powershell
npm run migrate                              # รันทุกไฟล์ที่ยังไม่ได้รัน
npm run migrate -- --status                  # ดูว่ารันอะไรไปแล้ว เหลืออะไร (ไม่แตะ DB)
npm run migrate -- db/migrate-review-queue.sql   # รันไฟล์เดียว
npm run migrate -- --baseline                # จด DB ที่รันมือมาก่อนแล้วเป็นจุดตั้งต้น
npm run db:auto                              # โหมดที่ prestart เรียกเอง (baseline ให้ถ้าจำเป็น แล้วรันที่ค้าง)
```

### รันเองพร้อมเซิร์ฟเวอร์

`prestart` และ `prestart:dev` เรียก `npm run db:auto` ต่อจากการเคลียร์พอร์ต — `npm start`
กับ `npm run start:dev` จึงพา DB ตามทัน repo ให้เองทุกครั้ง ไม่ต้องจำว่าต้องรัน migration ตอนไหน

โหมด `--auto` ต่างจาก `npm run migrate` เปล่า ๆ สองข้อ:

| สถานการณ์                          | `--auto` ทำอะไร                                                        |
| ---------------------------------- | ------------------------------------------------------------------------ |
| สมุด `schema_migrations` ยังว่าง   | `--baseline` ให้เองก่อนหนึ่งครั้ง แล้วค่อยรันที่เหลือ                     |
| ต่อ MySQL ไม่ติด / ไม่มีฐานข้อมูล  | เตือนแล้วปล่อยผ่าน — เซิร์ฟเวอร์ยังขึ้นได้เหมือนเดิม                      |
| ต่อติดแต่ไฟล์ migration พัง        | **หยุด ไม่ให้เซิร์ฟเวอร์ขึ้น** เพราะ schema ค้างกลางทางคืออาการที่ต้องแก้ก่อน |

ที่ยอมให้ผ่านตอนต่อ DB ไม่ติด เพราะเซิร์ฟเวอร์ที่ไม่มี DB ก็ error ตอนมีคนเรียก API เหมือนเดิมอยู่แล้ว
ไม่ใช่สถานะใหม่ที่ตัวรันทำให้เกิด — แต่ schema ที่ค้างกลางทางจะไปโผล่เป็น `ER_BAD_FIELD_ERROR`
ตอนมีคนใช้งานจริง ซึ่งอ่านแล้วเหมือนบั๊กในโค้ด จึงต้องหยุดตั้งแต่ตรงนี้

`npm run start:prod` (`node dist/main`) **ไม่มี** ขั้นนี้ — บน production ต้องสั่ง `npm run migrate` เองก่อน deploy

ตัวรันจดลงตาราง `schema_migrations` (ชื่อไฟล์ + checksum + เวลา) ซึ่ง**เพิ่งมี** — DB ที่รันมือมาก่อนหน้านี้ต้อง `--baseline` หนึ่งครั้ง ตัว baseline จะเช็ก `information_schema` ว่าตาราง/คอลัมน์ที่แต่ละไฟล์สร้างมีอยู่จริงไหมก่อนจด **ไม่ได้จดรวดทุกไฟล์** — ไฟล์ที่ของยังไม่ครบจะถูกปล่อยไว้ให้ `npm run migrate` รันจริง

รันซ้ำได้: คำสั่งที่ล้มเพราะ "คอลัมน์/ตาราง/index มีอยู่แล้ว" จะถูกข้ามพร้อมพิมพ์บอก ไฟล์ที่เคยพังกลางทาง (DDL ของ MySQL ย้อนกลับไม่ได้) จึงรันต่อจนจบได้

ลำดับการรันตั้งต้นจากชื่อไฟล์ แล้วจัดใหม่ตาม `-- requires:` ที่แต่ละไฟล์ประกาศไว้ (ดูหัวข้อลำดับด้านล่าง)

ตารางข้างล่างบอกว่าแต่ละไฟล์ทำอะไร ไม่ต้องรันทีละไฟล์เองแล้ว

| ไฟล์                                 | ทำอะไร                                                                                | ต้องรันเมื่อ                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `db/migrate-admin-columns.sql`       | เติมคอลัมน์ที่ตาราง `admin` ในดัมป์ยังไม่มี (email/photo/create_date/…) + ขยาย `password` เป็น 255 | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-longitude-precision.sql` | ขยาย `members.longitude` เป็น `decimal(11,8)`                                          | ฐานข้อมูลที่ import จาก dump รุ่นเก่า |
| `db/migrate-reading-location.sql`    | เพิ่ม `latitude` / `longitude` / `gps_accuracy_m` / `captured_at` ให้ `meter_readings` | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-meter-digits.sql`        | เพิ่ม `meter_digits` ให้ `meter_readings` (ด่านกัน OCR อ่านหลักหาย/เกิน)               | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-village-zipcode.sql`     | เพิ่ม `zip_code` ให้ `villages` แล้วเติมค่าเริ่มต้นจากตำบลที่เลือกไว้                  | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-member-accounts.sql`     | บัญชีลูกบ้าน — เพิ่ม `role` ให้ตาราง `admin` + สร้าง `account_members` (1 เบอร์ผูกได้หลายบ้าน) | ฐานข้อมูลที่ยังไม่มี `account_members` |
| `db/migrate-reports.sql`             | ตาราง `reports` สำหรับเรื่องที่ลูกบ้านแจ้ง — **ต้องรันหลัง `migrate-member-accounts.sql`** | ฐานข้อมูลที่ยังไม่มีตารางนี้          |
| `db/migrate-village-meter-pitch.sql` | เพิ่ม `meter_pitch_m` ให้ `villages` (ระยะเดินเฉลี่ยต่อมิเตอร์ ใช้คิดรัศมีเตือนตอนสแกน)   | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-bill-audit.sql`          | `bills.due_date` + `bills.period_months` + `meter_readings.read_confidence` + `villages.payment_due_days` | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-reading-audit.sql`       | ตาราง `reading_flags` (ร่องรอยการกดข้ามด่าน) + `meter_readings.entry_method` / `client_uuid` / `photo_purged_at` | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-bill-arrears.sql`        | ทบยอดค้าง — `bills.arrears_amount` / `grand_total` + ตาราง `bill_arrears`                | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-meters.sql`              | ทะเบียนมิเตอร์ (ตาราง `meters` + `meter_readings.meters_id`)                            | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-tenancies.sql`           | ผู้อยู่อาศัยแต่ละช่วง + บิลปิดยอดตอนย้ายออก (`bills.tenancy_id` / `is_final`)           | **ต้องรันหลัง `migrate-bill-arrears.sql`** |
| `db/migrate-unassigned-readings.sql` | ตาราง `unassigned_readings` — รูปที่ยังไม่รู้ว่าของบ้านไหน รอ Admin จับคู่               | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-village-usage-thresholds.sql` | เกณฑ์หน่วยน้ำผิดปกติรายหมู่บ้าน + `villages.gps_near_m`                            | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-admin-role.sql`          | `admin.admin_role` (`owner` / `staff`) — คุมว่าใครแก้บิลย้อนหลังได้                     | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-reading-edit-log.sql`    | ตาราง `meter_reading_logs` — ร่องรอยการแก้เลขมิเตอร์หลังออกบิล                          | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-meter-clusters.sql`      | `members.cluster_group_id` / `sequence_index` — มิเตอร์ที่ติดกันจน GPS แยกไม่ออก        | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-review-queue.sql`        | `unassigned_readings.members_id` / `blocked_code` / `blocked_reason` — คิวรอการตรวจสอบ  | **ต้องรันหลัง `migrate-unassigned-readings.sql`** |
| `db/migrate-match-provenance.sql`   | `meter_readings.matched_by` / `match_confidence` + ตาราง `bill_deletion_logs` (เก็บสำเนาบิลก่อนลบ) | **ต้องรันหลัง `migrate-reading-audit.sql`** |
| `db/migrate-utf8mb4.sql`             | รวม charset/collation ทุกตารางเป็น `utf8mb4_unicode_ci` ชุดเดียว                        | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-column-typos.sql`        | แก้ชื่อคอลัมน์ที่สะกดผิด (`craeta_date` / `craete_by` / `creat_date` / `members_id1`)     | **ต้องขึ้นพร้อมโค้ด NestJS รุ่นเดียวกัน** |
| `db/migrate-accounts-table.sql`      | แยกบัญชีลูกบ้านออกจากตาราง `admin` มาเป็นตาราง `accounts` + ทิ้งคอลัมน์ `admin.role`      | **ต้องขึ้นพร้อมโค้ด NestJS รุ่นเดียวกัน** |
| `db/migrate-not-null.sql`            | รัดคอลัมน์ที่โค้ดถือว่าต้องมีค่าเสมอ (ยอดเงิน/หน่วยน้ำ/รอบบิล/สถานะ) ให้เป็น `NOT NULL` | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |

ไม่มี `mysql` CLI ใน PATH บนเครื่องที่ใช้อยู่ (XAMPP ไม่ได้ใส่ให้) — `npm run migrate` ต่อผ่าน `mysql2` ที่มีอยู่ใน `node_modules` จึงไม่ต้องหาไฟล์ `mysql.exe` เอง

ถ้าอยากรันด้วย CLI จริง ๆ ตัวมันอยู่ที่ `C:\xampp\mysql\bin\mysql.exe`

⚠️ `migrate-admin-role.sql` ตั้งผู้ดูแลที่มีอยู่แล้วทุกคนเป็น `owner` เพื่อไม่ให้ใครถูกตัดสิทธิ์
กลางคัน — **ต้องไล่ลดคนที่ควรเป็น `staff` ด้วยมือหลังรัน** ไม่งั้นด่าน "ใครแก้บิลย้อนหลังได้"
จะไม่ได้กันอะไรเลย (คำสั่งตัวอย่างอยู่ในคอมเมนต์ท้ายไฟล์)

## ลำดับการรัน — `-- requires:`

ไฟล์ที่ต้องรันหลังไฟล์อื่นประกาศไว้ในหัวไฟล์ตัวเอง ตัวรันอ่านบรรทัดนี้แล้วจัดลำดับให้:

```sql
-- requires: migrate-meter-digits.sql, migrate-village-meter-pitch.sql
```

ไฟล์ที่ไม่ประกาศอะไรยังเรียงตามชื่อเหมือนเดิม ลำดับจึงยังเดาได้ ไม่ได้สลับทั้งชุดทุกครั้งที่เพิ่มไฟล์ใหม่
ประกาศชี้ไปไฟล์ที่ไม่มีอยู่ หรือประกาศวนกลับมาหาตัวเอง = ตัวรันโยน error ทิ้งตั้งแต่ยังไม่แตะ DB

⚠️ เดิมลำดับยึดชื่อไฟล์อย่างเดียว และเอกสารฉบับก่อนเขียนไว้ว่า "บังเอิญตรงกับลำดับตัวอักษรพอดี"
ซึ่ง**ไม่จริง** — มีอย่างน้อยสี่คู่ที่สลับกันอยู่ เช่น `migrate-bill-audit.sql` เติมคอลัมน์ต่อท้าย
`villages.meter_pitch_m` ที่ `migrate-village-meter-pitch.sql` เป็นคนสร้าง แต่ชื่อ `bill-`
มาก่อน `village-` การรันรวดบน DB ที่ตั้งใหม่จึงพังเสมอ บน DB ที่ `--baseline` มาแล้วอาการนี้ถูกบังไว้จนมองไม่เห็น

คู่ที่ประกาศไว้ตอนนี้:

| ไฟล์                                      | ต้องรันหลัง                                                  |
| ----------------------------------------- | ------------------------------------------------------------ |
| `migrate-meter-digits.sql`                | `migrate-reading-location.sql`                               |
| `migrate-member-accounts.sql`             | `migrate-admin-columns.sql`                                   |
| `migrate-bill-audit.sql`                  | `migrate-meter-digits.sql`, `migrate-village-meter-pitch.sql` |
| `migrate-reading-audit.sql`               | `migrate-bill-audit.sql`                                     |
| `migrate-match-provenance.sql`            | `migrate-reading-audit.sql`                                  |
| `migrate-village-usage-thresholds.sql`    | `migrate-village-meter-pitch.sql`, `migrate-bill-audit.sql`   |
| `migrate-review-queue.sql`                | `migrate-unassigned-readings.sql`                            |
| `migrate-reports.sql`                     | `migrate-member-accounts.sql`                                |
| `migrate-tenancies.sql`                   | `migrate-bill-arrears.sql`, `migrate-bill-audit.sql`          |
| `migrate-utf8mb4.sql`                     | ไฟล์ที่สร้างตารางทั้งหมด (ตารางต้องมีก่อนถึงจะแปลง charset ได้) |
| `migrate-column-typos.sql`                | ไฟล์ที่ยังอ้างชื่อคอลัมน์แบบเก่า                              |
| `migrate-accounts-table.sql`              | `migrate-member-accounts.sql`, `migrate-reports.sql`, `migrate-utf8mb4.sql` |
| `migrate-not-null.sql`                    | `migrate-column-typos.sql`, `migrate-utf8mb4.sql`, `migrate-bill-audit.sql` |

ไฟล์ใหม่ที่อ้างตาราง/คอลัมน์ของไฟล์อื่น (`AFTER`, `REFERENCES`, หรือ `ALTER` ตารางที่ไฟล์อื่นสร้าง)
ต้องเติม `-- requires:` ด้วยเสมอ ไม่ใช่หวังให้ชื่อไฟล์เรียงมาถูกเอง

## ไฟล์อื่นในโฟลเดอร์ `db/`

| ไฟล์                             | ทำอะไร                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `db/water-bill-db.sql`           | dump หลัก (schema + ข้อมูลจังหวัด/อำเภอ/ตำบล 8,369 แถว)                                                      |
| `db/seed-minimum.sql`            | ข้อมูลขั้นต่ำให้ "สร้างบิล" ทำงานได้ (`meter_readings` / `water_rates` / `admin` id=1) — **รันหลัง `seed:admin`** |
| `db/cleanup-orphan-readings.sql` | ล้าง `meter_readings` ที่ค้างจากบั๊กเก่า — ⚠️ ห้ามลบการจดครั้งแรกของแต่ละบ้าน อ่านคอมเมนต์ในไฟล์ก่อนรัน       |

---

## ทำไม `longitude` ต้องเป็น `decimal(11,8)`

ลองจิจูดของไทยอยู่ที่ 97–106 — เลข 3 หลักหน้าจุดทศนิยม แต่ `decimal(10,8)` เหลือที่ให้แค่ 2 หลัก (สูงสุด `99.99999999`) ทุกจังหวัดตั้งแต่ลองจิจูด 100 ขึ้นไป (กรุงเทพ 100.5, โคราช 102.1) จึงบันทึกไม่ได้ — strict mode เด้ง error 1264, ไม่ strict ก็โดนตัดเหลือ `99.99999999` เงียบ ๆ พิกัดเพี้ยนไปหลายร้อยกิโลเมตร

(ละติจูดไทย 5–20 เป็นเลข 2 หลัก ใช้ `decimal(10,8)` ได้ตามเดิม)

ท้าย `migrate-longitude-precision.sql` มีคิวรีไล่ดูว่ามีบ้านไหนโดนตัดไปแล้วบ้าง — ค่าที่โดนตัดกู้คืนไม่ได้ ต้องกรอกพิกัดใหม่

---

## บัญชีสองทะเบียน — `admin` กับ `accounts`

| ตาราง      | ใคร                | ล็อกอินยังไง            | เห็นอะไร                          |
| ---------- | ------------------ | ----------------------- | --------------------------------- |
| `admin`    | ผู้ดูแลหมู่บ้าน     | อีเมล + รหัสผ่าน (bcrypt) | หลังบ้านทั้งหมด                    |
| `accounts` | ลูกบ้าน            | เบอร์โทรอย่างเดียว       | บิลของบ้านที่ผูกไว้ใน `account_members` |

เดิมสองอย่างนี้อยู่ในตาราง `admin` ตารางเดียวกันแล้วแยกด้วยคอลัมน์ `role` ซึ่งทำให้
`POST /admin/all` คืนบัญชีลูกบ้านปนออกไปด้วย และทำให้ "ใครเป็นผู้ดูแล" ขึ้นอยู่กับค่าใน
คอลัมน์เดียวที่ `UPDATE` ผิดครั้งเดียวก็พลิกได้ — `db/migrate-accounts-table.sql` แยกออกมา
แล้วทิ้งคอลัมน์ `role` ทิ้ง ตอนนี้คำตอบมาจาก **ตารางที่บัญชีนั้นอยู่**

`admin_role` (`owner` / `staff`) เป็นคนละเรื่องและยังอยู่เหมือนเดิม — มันตอบว่า
"ผู้ดูแลคนนี้แก้บิลย้อนหลังได้ไหม" ไม่ได้ตอบว่า "เป็นผู้ดูแลหรือลูกบ้าน"

⚠️ ตอนย้าย **id ถูกยกมาทั้งค่าเดิม** ตั้งใจให้ตรงกัน เพราะ JWT ที่ออกไปแล้วเก็บ id ของบัญชี
ไว้ใน `sub` และมีอายุ 1 วัน ถ้าแจกเลขใหม่ ลูกบ้านที่ล็อกอินค้างไว้จะกระโดดไปเห็นบ้านของ
บัญชีอื่นทันที (`account_members.account_id` ยังเก็บเลขเดิมอยู่)

---

## ตาราง `admin` ใน dump เก่ากว่า entity

ตาราง `admin` ใน `db/water-bill-db.sql` มีแค่ 6 คอลัมน์ ขาดของที่โค้ดใช้จริงไปอีก 6 ตัว
และ `password` ยังเป็น `varchar(45)` ซึ่งสั้นกว่า bcrypt hash 60 ตัว —
`db/migrate-admin-columns.sql` เติมให้ครบแล้ว ไม่ต้องทำเอง

⚠️ เดิมงานนี้ซ่อนอยู่ใน `npm run seed:admin` ซึ่งทำให้**ลำดับติดตั้งเป็นวงกลม**:
`migrate-member-accounts.sql` ต้องการ `admin.email` ที่ seed เป็นคนเติม แต่ seed ใช้ TypeORM
repository ซึ่งอ่าน `admin_role` ที่ migration เป็นคนเพิ่ม — รันทางไหนก่อนก็พัง
(อาการคือ `Unknown column 'email' in 'admin'` หรือ `Unknown column 'AdminEntity.admin_role'`)

`npm run seed:admin` เหลือหน้าที่เดียวคือสร้างบัญชีแอดมิน รันซ้ำได้ไม่พัง
เปลี่ยนบัญชีเริ่มต้นได้ด้วย `SEED_ADMIN_*` ใน `.env` (ดู `.env.example`)

แอดมิน**คนแรก**ของระบบถูกตั้งเป็น `admin_role = 'owner'` ให้อัตโนมัติ —
`migrate-admin-role.sql` ยกผู้ดูแลที่ "มีอยู่แล้ว" ขึ้นเป็น owner แต่บนเครื่องที่ตั้งใหม่
ยังไม่มีใครเลยตอน migration นั้นรัน ถ้าไม่ตั้งให้ บัญชีเดียวของระบบจะเป็น `staff`
แล้วแก้บิลย้อนหลังไม่ได้ (บัญชีที่เปิดทีหลังยังเป็น `staff` ตามเดิม)
