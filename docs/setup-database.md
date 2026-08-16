# ตั้งค่าฐานข้อมูล

← [กลับหน้าหลัก](../README.md)

สร้าง database ชื่อ `water-bill-db` แล้ว import dump:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\water-bill-db.sql
```

จากนั้นรัน migration ที่ยังไม่ได้รวมเข้า dump (หัวข้อถัดไป) แล้วปิดท้ายด้วย `npm run seed:admin`

`synchronize` ถูกตั้งเป็น `false` ใน `src/app.module.ts` และ **ควรปล่อยไว้แบบนั้น** — ดู [known-issues.md](known-issues.md) ว่าเปิดแล้วอันตรายยังไง

---

## Migration ที่ต้องรันเอง

ไม่มีตารางบันทึกว่ารัน migration ไหนไปแล้ว (ไม่ได้ใช้ TypeORM migration) ต้องเทียบ entity กับ DB เอง — ทุกไฟล์รันซ้ำไม่ได้ ถ้าคอลัมน์มีอยู่แล้วจะ error ให้ข้ามไป

| ไฟล์                                 | ทำอะไร                                                                                | ต้องรันเมื่อ                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `db/migrate-longitude-precision.sql` | ขยาย `members.longitude` เป็น `decimal(11,8)`                                          | ฐานข้อมูลที่ import จาก dump รุ่นเก่า |
| `db/migrate-reading-location.sql`    | เพิ่ม `latitude` / `longitude` / `gps_accuracy_m` / `captured_at` ให้ `meter_readings` | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-meter-digits.sql`        | เพิ่ม `meter_digits` ให้ `meter_readings` (ด่านกัน OCR อ่านหลักหาย/เกิน)               | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-village-zipcode.sql`     | เพิ่ม `zip_code` ให้ `villages` แล้วเติมค่าเริ่มต้นจากตำบลที่เลือกไว้                  | ทุกฐานข้อมูล (ยังไม่อยู่ใน dump)      |
| `db/migrate-member-accounts.sql`     | บัญชีลูกบ้าน — เพิ่ม `role` ให้ตาราง `admin` + สร้าง `account_members` (1 เบอร์ผูกได้หลายบ้าน) | ฐานข้อมูลที่ยังไม่มี `account_members` |
| `db/migrate-reports.sql`             | ตาราง `reports` สำหรับเรื่องที่ลูกบ้านแจ้ง — **ต้องรันหลัง `migrate-member-accounts.sql`** | ฐานข้อมูลที่ยังไม่มีตารางนี้          |

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\migrate-reading-location.sql
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\migrate-meter-digits.sql
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\migrate-village-zipcode.sql
```

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
