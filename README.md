# WaterService — ระบบจัดการค่าน้ำประปาหมู่บ้าน

ระบบอ่านเลขมิเตอร์น้ำจากรูปถ่ายด้วยโมเดล YOLO แล้วคิดบิลค่าน้ำ ประกอบด้วย 4 ส่วนที่ต้องรันพร้อมกัน

```
┌─────────────────────┐
│  Angular  :4200     │   หน้าเว็บ (อยู่คนละ repo)
│  water-bill-web     │   ../../WaterWeb/water-bill-web
└──────────┬──────────┘
           │ HTTP + JSON
           ▼
┌─────────────────────┐  multipart/form-data  ┌──────────────────────┐
│  NestJS   :3000     │ ────────────────────► │  FastAPI   :8000     │
│  water-bill-service │ ◄──────────────────── │  meter-vision-service│
└──────────┬──────────┘         JSON          │  (YOLO best.pt)      │
           │ TypeORM                          └──────────────────────┘
           ▼
┌─────────────────────┐
│  MySQL    :3306     │
│  water-bill-db      │   XAMPP
└─────────────────────┘
```

| ส่วน           | โฟลเดอร์                                 | พอร์ต | ภาษา                                   |
| -------------- | ---------------------------------------- | ----- | -------------------------------------- |
| หน้าเว็บ       | `WaterWeb/water-bill-web`                | 4200  | Angular 21 (standalone, zoneless, SSR) |
| Backend        | `WaterService/water-bill-service-master` | 3000  | NestJS + TypeORM                       |
| Vision service | `WaterService/meter-vision-service`      | 8000  | Python 3.12 + FastAPI + Ultralytics    |
| ฐานข้อมูล      | XAMPP                                    | 3306  | MySQL / MariaDB                        |

---

## วิธีรัน (ต้องเปิด 3 อย่าง ตามลำดับนี้)

**1. MySQL** — เปิด XAMPP Control Panel แล้วกด Start ที่ MySQL

**2. Backend + Vision service** (คำสั่งเดียว รันทั้งคู่ผ่าน `concurrently`)

```powershell
cd water-bill-service-master
npm run start:dev
```

`start:dev` จะสตาร์ท NestJS (`[api]`) พร้อม FastAPI (`[vision]`) โดยหา Python จาก `meter-vision-service/venv` ให้เอง
ถ้ายังไม่ได้สร้าง venv มันจะข้าม vision service พร้อมพิมพ์วิธีติดตั้ง แล้วปล่อยให้ NestJS รันต่อตามปกติ
(อยากรันแยกก็ยังทำได้: `npm run start:api` และ `npm run start:vision`)

**3. หน้าเว็บ**

```powershell
cd ..\..\WaterWeb\water-bill-web
ng serve
```

เปิด `http://localhost:4200` — Swagger ของ backend อยู่ที่ `http://localhost:3000/api`

---

## ตั้งค่าฐานข้อมูลครั้งแรก

สร้าง database ชื่อ `water-bill-db` แล้ว import dump:

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root water-bill-db < db\water-bill-db.sql
```

`synchronize` ถูกตั้งเป็น `false` ใน `src/app.module.ts` และ **ควรปล่อยไว้แบบนั้น** — ดูหัวข้อ "ปัญหาที่ยังค้าง" ว่าทำไมการเปิดมันถึงอันตราย

### การแก้ schema ที่ทำไปแล้ว (ยังไม่ได้ใส่กลับใน dump)

ตาราง `admin` ใน `db/water-bill-db.sql` เก่ากว่า `AdminEntity` อยู่ 5 คอลัมน์ **และไม่มีแถวแอดมินเลยสักแถว** หลัง import dump ใหม่ให้รัน:

```powershell
npm run seed:admin
```

สคริปต์นี้เติมคอลัมน์ที่ขาด (เพิ่มอย่างเดียว ไม่ลบของเดิม) แล้วสร้างแอดมินเริ่มต้นให้ รันซ้ำได้ไม่พัง
เปลี่ยนบัญชีเริ่มต้นได้ด้วย `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` ใน `.env` (ดู `.env.example`)

หรือถ้าอยากรัน SQL เองก็ได้:

```sql
ALTER TABLE `admin`
  ADD COLUMN `create_date` datetime NOT NULL,
  ADD COLUMN `create_by`   int(11) DEFAULT NULL,
  ADD COLUMN `modify_by`   int(11) DEFAULT NULL,
  ADD COLUMN `modify_date` datetime DEFAULT NULL,
  ADD COLUMN `email`       varchar(100) NULL AFTER `lname`;

-- เติมอีเมลให้แถวที่มีอยู่ก่อน แล้วค่อยบังคับ NOT NULL + UNIQUE
UPDATE `admin` SET `email` = CONCAT('user', id, '@example.com') WHERE `email` IS NULL;
ALTER TABLE `admin` MODIFY COLUMN `email` varchar(100) NOT NULL;
ALTER TABLE `admin` ADD UNIQUE KEY `IDX_admin_email` (`email`);
```

---

## การเข้าสู่ระบบ

ใช้ **อีเมล** เป็น username (เดิมเคยใช้เบอร์โทร) ส่วน `phone` ยังอยู่ในตารางแต่เป็น nullable

บัญชีทดสอบ: `somying@example.com` / `password123` (สร้างด้วย `npm run seed:admin` — ไม่ได้มากับ dump)

หน้าเว็บเก็บ session ไว้ใน `localStorage` (key `water-bill.admin`) และมี `authGuard` กันหน้าที่ต้องล็อกอิน

| Route                                    | ต้องล็อกอิน                           |
| ---------------------------------------- | ------------------------------------- |
| `/login`, `/register`                    | ไม่ (ล็อกอินอยู่แล้วจะเด้งไป `/home`) |
| `/home`, `/scan`, `/history`, `/members` | ใช่                                   |

> **guard ป้องกันแค่หน้าเว็บ ไม่ได้ป้องกัน API** ทุก endpoint ของ backend ยังเรียกได้โดยไม่ต้องล็อกอิน

---

## API

### NestJS — `http://localhost:3000`

| Method          | Path                                                                                    | หมายเหตุ                            |
| --------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| POST            | `/auth/register`                                                                        | `{ fname, lname, email, password }` |
| POST            | `/auth/login`                                                                           | `{ email, password }`               |
| POST            | `/auth/google`                                                                          | ยังไม่เปิดใช้งาน (422 เสมอ)         |
| POST            | `/member/all`, `/member/find-one`, `/member/create`, `/member/update`, `/member/remove` |                                     |
| POST            | `/admin/all`, `/admin/find-one`, `/admin/create`, `/admin/update`, `/admin/remove`      |                                     |
| POST/GET        | `/meter-readings`, `/meter-readings/member/:memberId`                                   | ⚠️ GET พัง                          |
| POST            | `/meter-readings/ocr-upload`                                                            | อัปโหลดรูป → เรียก vision service   |
| POST/GET/DELETE | `/bills`, `/bills/:id`                                                                  |                                     |
| POST/GET        | `/villages`, `/villages/:id`                                                            | ⚠️ GET พัง                          |
| POST/GET        | `/water-rates`, `/water-rates/active`                                                   |                                     |

### Vision service — `http://localhost:8000`

| Method | Path      | หมายเหตุ                                                 |
| ------ | --------- | -------------------------------------------------------- |
| GET    | `/health` | เช็คสถานะ + ดู class ของโมเดล                            |
| POST   | `/detect` | อัปโหลดรูป (multipart field ชื่อ `file`) → คืนเลขมิเตอร์ |

โมเดลมี 12 class: `0`–`9` คือตัวเลขแต่ละหลัก, `10` = `border_decimal_point`, `11` = `border_water_meter_number`

ตัวอย่างผลลัพธ์ `/detect`:

```json
{
  "success": true,
  "read_unit": "00025",
  "integer_part": "00025",
  "decimal_part": "312",
  "full_reading": "00025312",
  "confidence": 0.91,
  "message": "สกัดค่าตัวเลขสำเร็จ"
}
```

`read_unit` (ส่วนจำนวนเต็ม สีดำบนหน้าปัด) คือค่าที่ backend เอาไปคิดบิล

---

## Environment variables

**Backend** — `.env`

| ตัวแปร               | ค่าเริ่มต้น             |
| -------------------- | ----------------------- |
| `VISION_SERVICE_URL` | `http://127.0.0.1:8000` |

**Vision service** — ตั้งผ่าน env ตอนรัน (ไม่มีไฟล์ `.env`)

| ตัวแปร           | ค่าเริ่มต้นในโค้ด   |
| ---------------- | ------------------- |
| `MODEL_PATH`     | `best.pt`           |
| `IMG_SIZE`       | `800` (ขนาดตอนเทรน) |
| `CONF_THRESHOLD` | `0.8`               |
| `PORT`           | `8000`              |

---

## ปัญหาที่ยังค้าง

### 🔴 `GET /villages` และ `GET /meter-readings` คืน 500

ชื่อคอลัมน์ใน entity ไม่ตรงกับในฐานข้อมูล (ฐานข้อมูลสะกดผิดมาแต่แรก):

| Entity ประกาศว่า                 | คอลัมน์จริงใน DB             |
| -------------------------------- | ---------------------------- |
| `VillageEntity.create_date`      | `villages.craeta_date`       |
| `MeterReadingEntity.members_id`  | `meter_readings.members_id1` |
| `MeterReadingEntity.create_date` | `meter_readings.creat_date`  |

ทำให้หน้า `/scan` และ `/history` ใช้ไม่ได้ แก้ได้สองทาง — เปลี่ยนชื่อคอลัมน์ใน DB ให้ถูก (ต้องระวัง FK ที่ผูกกับ `members_id1`) หรือใส่ `@Column({ name: 'craeta_date' })` ในเอนทิตีให้แมปชื่อผิดนั้น แบบที่ `member.entity.ts` ทำอยู่แล้ว

### 🔴 อย่าเปิด `synchronize: true`

`app.module.ts` ตั้ง `synchronize: false` ไว้ ถ้าเปิดเป็น `true` TypeORM จะเห็นว่าชื่อคอลัมน์ไม่ตรงตามตารางข้างบน แล้ว **drop คอลัมน์เก่าทิ้งพร้อม FK แล้วสร้างชื่อใหม่** schema จะเพี้ยนจาก `db/water-bill-db.sql` ถาวร

(ตาราง `provinces` / `districts` / `subdistricts` ที่มีข้อมูลรวม 8,369 แถว ไม่มี entity รองรับ TypeORM จึงไม่แตะ — ข้อมูลอ้างอิงพวกนั้นปลอดภัย)

### 🔴 รหัสผ่านเก็บเป็น plaintext และยังไม่มี JWT

`auth.service.ts` เทียบรหัสผ่านตรง ๆ ด้วย `admin.password !== data.password` และ `login` คืน object `admin` ทั้งก้อน **รวม password** กลับมาให้หน้าเว็บ ต้องทำ bcrypt + JWT ก่อนขึ้น production

### 🟡 ไม่มี `ValidationPipe`

DTO ไม่มี decorator ของ `class-validator` เลย body ที่ขาด field จะหลุดไปพังที่ระดับ TypeORM เป็น 500 ตอนนี้ `auth.service.ts` มี guard เช็ค `email`/`password` ด้วยมือ แต่ endpoint อื่นยังไม่มี

### 🟡 ตาราง `water_rates` ว่าง

`GET /water-rates/active` คืน 200 พร้อม body ว่าง ต้องมีอัตราค่าน้ำอย่างน้อย 1 แถวถึงจะคิดบิลได้

### 🟡 `CONF_THRESHOLD` ในโค้ดกับใน `meter-vision-service/README.md` ไม่ตรงกัน

โค้ดตั้ง `0.8` แต่ README ของ service นั้นบอก `0.35` ค่า 0.8 สูงมากสำหรับการตรวจเลขเล็ก ๆ บนหน้าปัด อาจทำให้ `/detect` คืน "ไม่พบตัวเลขมิเตอร์" บ่อยเกินจริง ปรับได้โดยไม่ต้องแก้โค้ด: `$env:CONF_THRESHOLD="0.35"` ก่อนรัน

---

## จุดที่มักสะดุด

**`EADDRINUSE: address already in use :::3000`** — `npm run start:dev` แตก process ลูกเป็น `node dist/main` (และ `python.exe` สำหรับ vision service) การกด Ctrl+C หรือปิด terminal บางครั้งฆ่าแค่ตัวแม่ ตัวลูกยังถือพอร์ตอยู่

ตอนนี้ `prestart:dev` จะรัน `scripts/free-ports.js` เคลียร์พอร์ต 3000 กับ 8000 ให้อัตโนมัติทุกครั้งก่อนสตาร์ท ปกติจึงไม่ควรเจอ error นี้อีก ถ้าอยากเคลียร์เองแยก ๆ:

```powershell
npm run free-ports
```

**ต้องเปิด MySQL ก่อน backend เสมอ** ไม่งั้น TypeORM ต่อไม่ติดตอน bootstrap

**Vision service ใช้เวลาโหลดโมเดลตอนสตาร์ท** ให้รอ `/health` ตอบ 200 ก่อนค่อยยิงงานเข้าไป

cd C:\Users\ajatu\Documents\WaterService\meter-vision-service

> > .\venv\Scripts\Activate.ps1
> > uvicorn main:app --port 8000

cd water-bill-service-master
npm run start:dev

🔴 คำตอบสั้นที่สุดก่อน: เรื่อง GPS จากรูป — ระบบยังไม่มีเลยสักบรรทัด
คำถามข้อ 1, 7, 8, 10 ทั้งหมดถามถึงพฤติกรรมที่ ยังไม่ถูกเขียน ไม่ใช่ว่าทำงานผิด แต่คือไม่มีโค้ดนั้นอยู่

หลักฐาน 3 จุด:

1. ไม่มีที่เก็บ — meter-reading.entity.ts มีแค่ reading_date, meter_unit, evidence_photo, members_id ไม่มีคอลัมน์ lat/lng ของรูป ไม่มี captured_at และ reading_date เป็น date เฉย ๆ ไม่มีเวลา ต่อให้อ่าน EXIF ได้ก็เก็บชั่วโมง/นาทีไม่ได้

2. ไม่มีคนอ่าน — ไม่มี exifr/piexif ใน package.json มีแค่ sharp และไม่มีโค้ดไหนแตะ EXIF

3. EXIF ถูกทำลาย 2 ชั้นก่อนถึงมือเรา — จุดนี้สำคัญที่สุด:

ชั้นแรก: หน้าเว็บย่อรูปด้วย canvas ก่อนส่ง (ตามคอมเมนต์ใน meter-photo.service.ts:28) — canvas วาดใหม่ = EXIF หายทั้งหมดตั้งแต่ยังไม่ออกจากมือถือ
ชั้นสอง: meter-photo.service.ts:52-58 sharp().rotate().jpeg() — sharp ทิ้ง metadata ทุกอย่างเป็นค่าเริ่มต้น (คอมเมนต์บรรทัด 53 เขียนไว้เองว่า "หมุนตาม EXIF แล้วลบ EXIF ทิ้ง")
ข้อเสนอ: อย่าไปไล่กู้ EXIF ครับ ใช้ navigator.geolocation.getCurrentPosition() ตอนกดชัตเตอร์ในหน้าเว็บแทน แล้วส่ง lat/lng/accuracy/captured_at มาเป็น field ใน DTO ตรง ๆ — ได้ค่า accuracy แถมมาด้วย (EXIF ไม่มีให้) และไม่ต้องพึ่งว่าลูกบ้าน/พนักงานเปิด geotag ไว้หรือเปล่า ซึ่งส่วนใหญ่ปิด

members.latitude/longitude มีอยู่ใน member.entity.ts:22-38 จริง แต่ comment ใน DB บอกเจตนาไว้ชัดว่า "เผื่อพนักงานใช้แผนที่นำทางไปบ้าน" — ไม่มีโค้ดไหนเอาไปเทียบระยะ

✅ เคสที่ระบบ "จัดการอยู่แล้ว"
เคส เกิดอะไรขึ้น โค้ด
ไม่อัพภาพ ออกบิลได้ปกติ meter_photo เป็น optional บิลได้เลขแต่ไม่มีหลักฐานรูป bills.service.ts:279
มิเตอร์น้อยกว่าเดือนที่แล้ว บล็อก 400 ทันที ไม่ให้ออกบิล ข้อความไทยบอกทั้งเลขที่จดและเลขตั้งต้น bills.service.ts:241-245
สูงผิดสังเกต 409 Conflict ต้องกด confirm_high_usage ยืนยันก่อน ไม่บล็อกตาย bills.service.ts:145-172
ไม่มีบิลเดือนนั้น ข้ามไปหาบิลใบล่าสุดที่เก่ากว่ามาเป็นตัวตั้ง bills.service.ts:104-118
"ผิดสังเกต" คิดจากอะไร — 2 เกณฑ์ แล้วแต่ว่าบ้านนั้นมีประวัติหรือยัง:

มีประวัติ: หน่วยเดือนนี้ > ค่าเฉลี่ยทุกบิลที่ผ่านมา × 5 และ > 50 หน่วย (เงื่อนไข 50 กันบ้านที่ปกติใช้ 2 หน่วย พอใช้ 11 หน่วยแล้วเด้ง)
ไม่มีประวัติ (บ้านใหม่): > 1000 หน่วย ตายตัว
จุดอ่อนที่ควรรู้: ค่าเฉลี่ยคิดจากทุกบิลตลอดกาล ไม่ใช่ 3-6 เดือนล่าสุด — บ้านที่เคยท่อแตกจะดันค่าเฉลี่ยขึ้นถาวรจนด่านนี้อ่อนลงไปเรื่อย ๆ

⚠️ เคสที่ยังไม่มีการจัดการ — 4 เรื่อง

1. ไม่จ่ายค่าน้ำ / ทบบิล — ไม่มีอะไรเลย
   payment_status enum มี 'Overdue' ประกาศไว้ใน bill.entity.ts:42 แต่ไม่มีโค้ดไหนตั้งค่านี้เลย ไม่มี due_date ไม่มี cron ที่วิ่งเปลี่ยนสถานะ ไม่มีค่าปรับ ไม่มีการทบยอดข้ามเดือน

ผลจริง: บ้านที่ไม่จ่าย 6 เดือน = มีบิล Pending 6 ใบแยกกันเฉย ๆ เดือนที่ 7 ก็ยังออกบิลปกติราวกับไม่มีอะไรค้าง ต้องให้คนเปิดดูเองว่าค้างกี่ใบ

2. reading_date อดีต/อนาคต — ไม่ตรวจอะไรเลย
   โปรเจกต์นี้ไม่ได้เปิด global ValidationPipe และ DTO ไม่มี class-validator (คอมเมนต์ยืนยันเองที่ reports.service.ts:33) บวกกับ bills.service.ts:311 ที่เขียน new Date(dto.reading_date) ดิบ ๆ:

วันที่อนาคต (2030-12-31) → ผ่านฉลุย บันทึกลง DB
วันที่อดีตไกล (1999-01-01) → ผ่านฉลุยเช่นกัน
string มั่ว ("เมื่อวาน") → Invalid Date → MySQL เด้ง → 500 ที่ผู้ใช้อ่านไม่รู้เรื่อง
ที่ร้ายที่สุด: reading_date กับ billing_month/billing_year ไม่เชื่อมกันเลย ส่ง reading_date: 2020-01-01 คู่กับ billing_month: '08', billing_year: '2026' ได้สบาย ๆ ไม่มีใครทัก
ถ้าจะแก้ ที่นี่คือจุดเดียว: ตรวจใน prepareBill() ว่า reading_date ต้องไม่เกินวันนี้ และต้องตกอยู่ในเดือนที่ออกบิล (หรือคาบเกี่ยวไม่เกิน ±15 วัน สำหรับกรณีจดปลายเดือน/ต้นเดือนถัดไป)

3. อัพ 5 ภาพแล้วเป็นบ้านที่ 1 ทั้งหมด
   ต้องเข้าใจก่อนว่า ระบบไม่เคยเลือกบ้านจากภาพ — คนกดเลือก members_id เอง แล้ว OCR อ่านแค่ตัวเลข (main.py คืนแค่ read_unit ไม่มีข้อมูลบ้าน) เคสนี้จึงเกิดจากคนพลาด ไม่ใช่ AI

ผลลัพธ์จริง:

ภาพที่ 1 → บิลออกสำเร็จ
ภาพที่ 2-5 → 409 "บ้านหลังนี้ออกบิลเดือน 08/2026 ไปแล้ว" (bills.service.ts:213) — ด่านนี้ช่วยไว้
แต่ถ้าพนักงานกด "จดทับ" (replace: true) รัว ๆ → ทับกันจนเหลือใบสุดท้าย บ้านที่ 1 ได้เลขของบ้านที่ 5 และเดือนหน้าตัวตั้งผิดยกแถว ส่วนบ้าน 2-5 ไม่มีบิล ไม่มีใครเตือน 4. OCR อ่านผิด — ช่องโหว่ตรงกลาง
อ่านไม่ได้ → ปลอดภัย: คืน success: false, read_unit: null + ข้อความไทย ให้คนกรอกเอง
อ่านผิดจนต่ำกว่าเดือนก่อน → ด่านที่ 1 จับ (400)
อ่านผิดจนสูงมาก → ด่านที่ 2 จับ (409)
อ่านผิดนิดเดียว (1250 → 1258, หรือหลักหายไป 1 ตัว) → ทะลุทุกด่าน ออกบิลเงียบ ๆ ตรงนี้ไม่มีอะไรจับได้เลย
จุดที่ควรเสริมอยู่ใน main.py:118: CONF_THRESHOLD 0.8 กรองรายหลัก แต่ไม่เคยเช็คจำนวนหลัก — มิเตอร์รุ่นเดียวกันมีหลักคงที่ (ปกติ 5 หลัก) ถ้าอ่านได้ 4 หลักคือมีหลักหาย ควรตีเป็นอ่านไม่สำเร็จมากกว่าคืนเลขที่น้อยไป 1 หลัก และควรเทียบกับจำนวนหลักของการจดเดือนก่อนของบ้านหลังนั้นด้วย

📏 เรื่องระยะ: จะรู้ได้ไงว่าเป็นบ้านหลังนี้
สูตรที่ใช้: Haversine (หรือ equirectangular ก็พอ ระยะสั้นแค่ร้อยเมตรต่างกันไม่ถึง 1 ซม.) ที่ละติจูดไทย ~15°:

0.00001° lat ≈ 1.11 ม.
0.00001° lng ≈ 1.07 ม.
แต่นี่คือคำตอบที่สำคัญกว่า — งบความคลาดเคลื่อนจริง:

สภาพตอนถ่าย คลาดเคลื่อน
กลางแจ้ง เห็นฟ้าโล่ง 3–10 ม.
ยืนติดตัวบ้าน / ใต้ชายคา / ข้างกำแพงปูน 10–30 ม.
หลังคาสังกะสี / ซอยแคบ / ต้นไม้ทึบ 30–100 ม.
เพิ่งเปิดกล้อง GPS ยังไม่ fix หลายร้อยเมตร – กิโล (ตำแหน่งจากเสาสัญญาณ)
ในขณะที่บ้านในหมู่บ้านไทยห่างกันจริง ๆ แค่ 8–20 ม.

👉 ข้อสรุป: รัศมีที่ใหญ่พอจะไม่ปฏิเสธคนที่ถ่ายถูกบ้านจริง จะครอบบ้านข้าง ๆ 3-5 หลังเสมอ GPS จึงใช้ "ยืนยันว่าใช่บ้านนี้" ไม่ได้ — ใช้ได้แค่ "จับที่ผิดชัด ๆ" (ถ่ายจากที่ทำการ อบต. / ถ่ายที่บ้านตัวเอง / คนละหมู่บ้าน)

เกณฑ์ที่ผมแนะนำ:

ทิ้งพิกัดที่ห่วยก่อน — ถ้า accuracy > 50 ม. อย่าเอามาตัดสินอะไรเลย บันทึกไว้เฉย ๆ ไม่งั้นจะได้ false alarm รัวจนพนักงานเลิกสนใจ
ระยะ (d) จากบ้านที่เลือก:
d ≤ max(30, accuracy) → 🟢 ผ่าน
d ≤ 150 → 🟡 บันทึกธง ไม่บล็อก
d > 150 หรือไม่มีบ้านไหนอยู่ใน 150 ม. → 🔴 ให้ยืนยันก่อน (แนวเดียวกับ confirm_high_usage ที่มีอยู่แล้ว)
สัญญาณที่ดีกว่าระยะเดี่ยว ๆ — เช็ค "อันดับ": บ้านที่เลือกเป็นบ้านที่ใกล้ที่สุดหรือเปล่า ถ้ามีบ้านอื่นใกล้กว่า เกิน 2 เท่า → เตือนว่า "พิกัดนี้ใกล้บ้านเลขที่ 45 มากกว่า ใช่บ้านนี้แน่ไหมครับ" อันนี้จับเคส "5 ภาพเป็นบ้านที่ 1 หมด" ได้ตรง ๆ
แม่นที่สุด — เทียบกับตัวเอง ไม่ใช่เทียบกับทะเบียน: เก็บพิกัดทุกครั้งที่จด แล้วเทียบกับ median ของพิกัดที่เคยจดบ้านหลังนี้ พิกัดใน members กรอกครั้งเดียวตอนลงทะเบียน (อาจจิ้มจากแผนที่ ไม่ได้ยืนถ่ายจริง) ส่วน median ของ 6 เดือนคือ "จุดที่พนักงานยืนถ่ายมิเตอร์นี้จริง ๆ" ซึ่งตัด systematic error ทิ้งไปได้เยอะ
ตอบข้อ "ถ้า lat/lng ตรงเป๊ะจะเกิดอะไรขึ้น": ควรระวังนะครับ — พิกัดที่ตรงกันเป๊ะทุกทศนิยม ระหว่างการจด 2 ครั้งต่างเดือน คือสัญญาณว่ารูปถูก copy มาใช้ซ้ำ ไม่ใช่สัญญาณว่าถูกต้อง GPS จริงไม่มีทางให้ค่าเดิมเป๊ะสองครั้ง ตัวนี้เป็น fraud signal ที่ดีมากถ้าเก็บพิกัดแล้ว

🐛 บั๊กที่เจอระหว่างอ่าน (ไม่ได้ถาม แต่เกี่ยวตรง ๆ กับ GPS)
longitude เก็บลองจิจูดของไทยไม่ได้ครับ

water-bill-db.sql:1024 และ member.entity.ts:31-38 ประกาศเป็น decimal(10,8) = มีที่ให้เลขหน้าจุดแค่ 2 หลัก สูงสุด 99.99999999

แต่ลองจิจูดประเทศไทยอยู่ที่ 97–106 เป็นเลข 3 หลัก — ตัวอย่างใน member-create.dto.ts:25 เองเขียน 102.097771 (โคราช) ซึ่งล้นแน่นอน

ผลที่จะเกิด: MySQL strict mode → error 1264 Out of range value บันทึกลูกบ้านไม่ได้; ถ้าไม่ strict → โดนตัดเหลือ 99.99999999 เงียบ ๆ = พิกัดเพี้ยนไปหลายร้อยกิโล ต่อให้เขียนโค้ดเทียบระยะเสร็จก็ใช้ไม่ได้

latitude ไม่มีปัญหา (ไทยอยู่ 5–20 = 2 หลัก พอดี) ต้อง ALTER COLUMN longitude DECIMAL(11,8) ก่อนจะทำเรื่อง GPS ต่อครับ

ถ้าจะให้ลุยต่อ ผมแนะนำลำดับนี้: แก้ longitude → ตรวจ reading_date → เก็บ lat/lng/accuracy ตอนจด (ผ่าน Geolocation API ไม่ใช่ EXIF) → ค่อยเปิดด่านเตือนระยะ อยากให้เริ่มข้อไหนก่อนบอกได้เลยครับ
