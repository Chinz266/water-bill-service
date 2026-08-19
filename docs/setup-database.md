# ตั้งค่าฐานข้อมูล

← [กลับหน้าหลัก](../README.md)

สร้าง database ชื่อ `water-bill-db` แล้ว import dump:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\water-bill-db.sql
```

จากนั้นรัน migration ที่ยังไม่ได้รวมเข้า dump (หัวข้อถัดไป) แล้วปิดท้ายด้วย `npm run seed:admin`

`synchronize` ถูกตั้งเป็น `false` ใน `src/app.module.ts` และ **ควรปล่อยไว้แบบนั้น** — ดู [known-issues.md](known-issues.md) ว่าเปิดแล้วอันตรายยังไง

---

## Migration — `npm run migrate`

```powershell
npm run migrate                              # รันทุกไฟล์ที่ยังไม่ได้รัน
npm run migrate -- --status                  # ดูว่ารันอะไรไปแล้ว เหลืออะไร (ไม่แตะ DB)
npm run migrate -- db/migrate-review-queue.sql   # รันไฟล์เดียว
npm run migrate -- --baseline                # จด DB ที่รันมือมาก่อนแล้วเป็นจุดตั้งต้น
```

ตัวรันจดลงตาราง `schema_migrations` (ชื่อไฟล์ + checksum + เวลา) ซึ่ง**เพิ่งมี** — DB ที่รันมือมาก่อนหน้านี้ต้อง `--baseline` หนึ่งครั้ง ตัว baseline จะเช็ก `information_schema` ว่าตาราง/คอลัมน์ที่แต่ละไฟล์สร้างมีอยู่จริงไหมก่อนจด **ไม่ได้จดรวดทุกไฟล์** — ไฟล์ที่ของยังไม่ครบจะถูกปล่อยไว้ให้ `npm run migrate` รันจริง

รันซ้ำได้: คำสั่งที่ล้มเพราะ "คอลัมน์/ตาราง/index มีอยู่แล้ว" จะถูกข้ามพร้อมพิมพ์บอก ไฟล์ที่เคยพังกลางทาง (DDL ของ MySQL ย้อนกลับไม่ได้) จึงรันต่อจนจบได้

⚠️ เรียงลำดับด้วย**ชื่อไฟล์** ซึ่งไม่ใช่ลำดับที่ควรรันจริงเสมอไป (ดูข้อควรระวังเรื่องลำดับด้านล่าง) — ตั้ง DB ใหม่ทั้งก้อนให้ import `db/water-bill-db.sql` แล้วค่อย `--baseline`

ตารางข้างล่างบอกว่าแต่ละไฟล์ทำอะไร ไม่ต้องรันทีละไฟล์เองแล้ว

| ไฟล์                                 | ทำอะไร                                                                                | ต้องรันเมื่อ                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------- |
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

ไม่มี `mysql` CLI ใน PATH บนเครื่องที่ใช้อยู่ (XAMPP ไม่ได้ใส่ให้) — `npm run migrate` ต่อผ่าน `mysql2` ที่มีอยู่ใน `node_modules` จึงไม่ต้องหาไฟล์ `mysql.exe` เอง

ถ้าอยากรันด้วย CLI จริง ๆ ตัวมันอยู่ที่ `C:\xampp\mysql\bin\mysql.exe`

⚠️ `migrate-admin-role.sql` ตั้งผู้ดูแลที่มีอยู่แล้วทุกคนเป็น `owner` เพื่อไม่ให้ใครถูกตัดสิทธิ์
กลางคัน — **ต้องไล่ลดคนที่ควรเป็น `staff` ด้วยมือหลังรัน** ไม่งั้นด่าน "ใครแก้บิลย้อนหลังได้"
จะไม่ได้กันอะไรเลย (คำสั่งตัวอย่างอยู่ในคอมเมนต์ท้ายไฟล์)

⚠️ **ลำดับสำคัญ** — `migrate-tenancies.sql` สร้าง FK ไปที่ `bills` จึงต้องรันหลังคอลัมน์
ของ `migrate-bill-arrears.sql` ถูกเพิ่มแล้ว, `migrate-meters.sql` ต้องมาก่อนไฟล์ที่อ้าง `meters`,
และ `migrate-review-queue.sql` ต้องมาหลัง `migrate-unassigned-readings.sql` (ตารางต้องมีก่อนถึงจะเพิ่มคอลัมน์ได้)

ตอนนี้ข้อบังคับทั้งสามข้อ**บังเอิญตรงกับลำดับตัวอักษรพอดี** ตัวรันจึงยังปลอดภัย — แต่มันบังเอิญ
ไม่ใช่การออกแบบ ไฟล์ใหม่ที่พึ่งไฟล์เก่าซึ่งชื่อเรียงหลังกว่า ต้องรันไฟล์นั้นเองก่อนด้วยมือ

ไฟล์อื่นในโฟลเดอร์ `db/`:

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

## ตาราง `admin` ใน dump เก่ากว่า entity

ตาราง `admin` ใน `db/water-bill-db.sql` เก่ากว่า `AdminEntity` อยู่ 5 คอลัมน์ **และไม่มีแถวแอดมินเลยสักแถว** หลัง import ให้รัน:

```powershell
npm run seed:admin
```

สคริปต์นี้เติมคอลัมน์ที่ขาด (เพิ่มอย่างเดียว ไม่ลบของเดิม) ขยาย `password` ให้พอกับ bcrypt hash 60 ตัว แล้วสร้างแอดมินเริ่มต้น รันซ้ำได้ไม่พัง

เปลี่ยนบัญชีเริ่มต้นได้ด้วย `SEED_ADMIN_*` ใน `.env` (ดู `.env.example`)
