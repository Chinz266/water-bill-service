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
