# WaterService — ระบบจัดการค่าน้ำประปาหมู่บ้าน

อ่านเลขมิเตอร์น้ำจากรูปถ่ายด้วยโมเดล YOLO แล้วคิดบิลค่าน้ำ ประกอบด้วย 4 ส่วนที่ต้องรันพร้อมกัน

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

| ส่วน           | โฟลเดอร์                            | พอร์ต | ภาษา                                   |
| -------------- | ----------------------------------- | ----- | -------------------------------------- |
| หน้าเว็บ       | `WaterWeb/water-bill-web`           | 4200  | Angular 21 (standalone, zoneless, SSR) |
| Backend        | `WaterService/water-bill-service`   | 3000  | NestJS + TypeORM                       |
| Vision service | `WaterService/meter-vision-service` | 8000  | Python 3.12 + FastAPI + Ultralytics    |
| ฐานข้อมูล      | XAMPP                               | 3306  | MySQL / MariaDB                        |

---

## เริ่มใช้งานครั้งแรก

1. **ฐานข้อมูล** — สร้าง `water-bill-db`, import dump, รัน migration, seed แอดมิน → [docs/setup-database.md](docs/setup-database.md)
2. **Environment** — คัดลอก `.env.example` เป็น `.env` แล้วตั้ง `JWT_SECRET` (ไม่ตั้ง แอปล้มตอน boot โดยเจตนา)

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

3. **รัน** — ตามหัวข้อถัดไป

---

## วิธีรัน (เปิด 3 อย่าง ตามลำดับ)

**1. MySQL** — เปิด XAMPP Control Panel กด Start ที่ MySQL (ต้องขึ้นก่อน backend เสมอ ไม่งั้น TypeORM ต่อไม่ติดตอน bootstrap)

**2. Backend + Vision service** — คำสั่งเดียว รันทั้งคู่ผ่าน `concurrently`

```powershell
cd water-bill-service
npm run start:dev
```

`npm start` และ `npm run start:dev` สตาร์ท NestJS (`[api]`) พร้อม FastAPI (`[vision]`) เสมอ ต่างกันแค่ `start:dev` เปิด `--watch`
`prestart` / `prestart:dev` เคลียร์พอร์ต 3000 กับ 8000 ให้ก่อนอัตโนมัติ
(รันแยกได้: `npm run start:api`, `npm run start:vision`)

**3. หน้าเว็บ**

```powershell
cd ..\..\WaterWeb\water-bill-web
ng serve
```

เปิด `http://localhost:4200` — Swagger ของ backend อยู่ที่ `http://localhost:3000/api`

### venv ของ vision service ติดตั้งให้เอง

`scripts/start-vision.ts` หา Python จาก `meter-vision-service/venv` (หรือ `.venv`) รองรับทั้ง Windows และ macOS/Linux **ถ้ายังไม่มี venv จะสร้างให้เองแล้ว `pip install -r requirements.txt` ต่อทันที** — ครั้งแรกนาน เพราะ `ultralytics` ลาก `torch` มาราว 2GB ครั้งต่อไปเจอ venv เดิมแล้วสตาร์ทเลย

ติดตั้งไม่สำเร็จ (ไม่มี Python / pip พัง) สคริปต์พิมพ์วิธีติดตั้งเองแล้วจบด้วย exit code 0 **โดยเจตนา** — `concurrently` ตั้ง `--kill-others-on-fail` ไว้ ถ้าจบแบบ error NestJS จะถูกฆ่าตามไปด้วย ผลคือ backend รันต่อได้ เสียแค่หน้าสแกนมิเตอร์

> ⚠️ `torch` ยังไม่มี wheel ให้ Python รุ่นใหม่สุดเสมอไป ถ้า pip ล้มตอน bootstrap ให้สร้าง venv ด้วย **Python 3.12** เอง:
>
> ```powershell
> cd meter-vision-service
> py -3.12 -m venv venv
> .\venv\Scripts\Activate.ps1
> pip install -r requirements.txt
> ```

---

## คำสั่งที่ใช้บ่อย

| คำสั่ง               | ทำอะไร                                                |
| -------------------- | ----------------------------------------------------- |
| `npm run start:dev`  | รัน API + vision service พร้อม watch                  |
| `npm test`           | unit test (ปัจจุบัน **81 เทสต์ ผ่านทั้งหมด**)         |
| `npm run test:watch` | รันเทสต์ค้างไว้ แก้โค้ดแล้วรันซ้ำให้เอง               |
| `npm run seed:admin` | เติมคอลัมน์ที่ตาราง `admin` ขาด + สร้างแอดมินเริ่มต้น |
| `npm run free-ports` | เคลียร์พอร์ต 3000 / 8000 ที่ค้างอยู่                  |
| `npm run lint`       | ESLint + Prettier (แก้อัตโนมัติ)                      |
| `npm run build`      | build ลง `dist/`                                      |

เทสต์ทั้ง 81 ตัวเป็น unit test ที่ mock repository ไม่ต้องต่อฐานข้อมูล กระจายใน 5 ไฟล์:

| ไฟล์                             | ครอบอะไร                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| `bills.service.spec.ts`          | เดือน/ปีบิล, วันที่จด, เปลี่ยนมิเตอร์/วนรอบ, จำนวนหลัก, ลบบิล, พิกัด |
| `scan-batch.service.spec.ts`     | จับคู่รูปกับบ้าน, รูปชี้บ้านซ้ำ, บ้านที่ออกบิลแล้ว, จำนวนหลัก, EXIF  |
| `member.service.spec.ts`         | ด่านตรวจพิกัด, ลงทะเบียนแบบยืนที่มิเตอร์, ลบลูกบ้าน                  |
| `photo-metadata.service.spec.ts` | อ่าน EXIF, Haversine                                                 |
| `app.controller.spec.ts`         | smoke test                                                           |

---

## Environment variables

| ตัวแปร                           | ค่าเริ่มต้น             | หมายเหตุ                                           |
| -------------------------------- | ----------------------- | -------------------------------------------------- |
| `JWT_SECRET`                     | —                       | **ต้องตั้ง** ไม่ตั้งแอปจะโยน error ตั้งแต่ตอน boot |
| `JWT_EXPIRES_IN`                 | `1d`                    |                                                    |
| `VISION_SERVICE_URL`             | `http://127.0.0.1:8000` |                                                    |
| `DB_HOST` / `DB_PORT` / `DB_*`   | localhost / 3306 / root | ใช้โดย `npm run seed:admin` เท่านั้น               |
| `SEED_ADMIN_EMAIL` / `_PASSWORD` | ดู `.env.example`       | บัญชีแอดมินที่ seed สร้างให้                       |

ตั้งใจให้แอปล้มเลยดีกว่าปล่อยให้รันด้วย secret ค่าว่าง ซึ่งใครก็ปลอม token ได้

**Vision service** — ตั้งผ่าน env ตอนรัน (ไม่มีไฟล์ `.env`)

| ตัวแปร           | ค่าเริ่มต้นในโค้ด   |
| ---------------- | ------------------- |
| `MODEL_PATH`     | `best.pt`           |
| `IMG_SIZE`       | `800` (ขนาดตอนเทรน) |
| `CONF_THRESHOLD` | `0.8`               |
| `PORT`           | `8000`              |

---

## การเข้าสู่ระบบ

ผู้ใช้ 2 ชนิด แยก token คนละชุด

| ชนิด              | สมัคร                        | ล็อกอินด้วย | เห็นอะไร                  |
| ----------------- | ---------------------------- | ----------- | ------------------------- |
| แอดมิน (หมู่บ้าน) | `POST /auth/register`        | อีเมล       | ทุกอย่าง                  |
| ลูกบ้าน           | `POST /auth/member/register` | เบอร์โทร    | เฉพาะบ้านตัวเอง (`/me/*`) |

ลูกบ้านสมัครได้เฉพาะเบอร์ที่มีบ้านลงทะเบียนไว้แล้ว — ผูกผ่านตาราง `account_members` (บัญชีเดียวดูได้หลายบ้าน)

บัญชีแอดมินทดสอบ: `somying@example.com` / `password123` (มาจาก `npm run seed:admin` ไม่ได้มากับ dump)

API ป้องกันด้วย `JwtAuthGuard` + `RolesGuard` ที่ลงทะเบียนเป็น `APP_GUARD` ระดับ global — **ทุก route ปิดเป็นค่าเริ่มต้น** route สาธารณะต้องแปะ `@Public()` เอง (ลืมแปะ = ปิด ซึ่งปลอดภัยกว่าลืมแปะ = เปิดทิ้ง)

---

## เอกสารเพิ่มเติม

| ไฟล์                                                | เนื้อหา                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| [docs/setup-database.md](docs/setup-database.md)     | import dump, migration ที่ต้องรันเอง, seed แอดมิน, เรื่อง `decimal(11,8)`   |
| [docs/api.md](docs/api.md)                           | ตาราง endpoint ทั้งหมด, พอร์ทัลลูกบ้าน, สัญญาของ vision service             |
| [docs/billing-rules.md](docs/billing-rules.md)       | เลขตั้งต้นที่ใช้คิดหน่วย, ด่านกันข้อมูลผิดตอนออกบิล, ลงทะเบียนแบบยืนที่มิเตอร์ |
| [docs/scan-batch.md](docs/scan-batch.md)             | จับคู่รูปกับบ้าน, บทบาทของ GPS, EXIF หายง่ายแค่ไหน                          |
| [docs/known-issues.md](docs/known-issues.md)         | ปัญหาที่ยังค้าง, ช่องที่ยังหลุด, จุดที่มักสะดุด                              |
| [meter-vision-service/README.md](meter-vision-service/README.md) | รายละเอียดฝั่งโมเดล YOLO                                       |

---

## กฎการเขียนโค้ด

- TypeScript เท่านั้น (ห้าม JavaScript)
- Angular component ใช้ `standalone: true` เสมอ
- UI ใช้คลาสและตัวแปรสีจาก `styles.css` ธีม Sci-Fi
- ข้อความแจ้งเตือนผู้ใช้เป็นภาษาไทย
- อย่าเปิด `synchronize: true` — เหตุผลอยู่ใน [docs/known-issues.md](docs/known-issues.md)
