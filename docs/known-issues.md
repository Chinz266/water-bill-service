# ปัญหาที่ยังค้าง และจุดที่มักสะดุด

← [กลับหน้าหลัก](../README.md)

## 🔴 อย่าเปิด `synchronize: true`

`app.module.ts` ตั้ง `synchronize: false` ไว้ ถ้าเปิดเป็น `true` TypeORM จะเห็นว่าชื่อคอลัมน์ไม่ตรง (`creat_date` ไม่มี e, `members_id1` มี 1 ต่อท้าย, `craeta_date` / `craete_by` สะกดสลับ) แล้ว **drop คอลัมน์เก่าทิ้งพร้อม FK แล้วสร้างชื่อใหม่** schema จะเพี้ยนจาก `db/water-bill-db.sql` ถาวร

(ตาราง `provinces` / `districts` / `subdistricts` ที่มีข้อมูลรวม 8,369 แถว ไม่มี entity รองรับ TypeORM จึงไม่แตะ — ข้อมูลอ้างอิงพวกนั้นปลอดภัย)

## 🟡 ไม่มี global `ValidationPipe`

`class-validator` อยู่ใน dependencies แล้วแต่ DTO ยังไม่มี decorator และ `main.ts` ยังไม่เปิด pipe

ตอนนี้แต่ละ service ต้องดักเองด้วยมือ — `auth.service.ts` เช็ค `email`/`password`, `member.service.ts` เช็คช่วงพิกัดและ accuracy, `bills.service.ts` เช็คเดือน/ปี/วันที่จด/พิกัด, `reports.service.ts` เช็คหมวดหมู่ ยิ่งเพิ่ม endpoint ยิ่งลืม ควรเปิด global `ValidationPipe` แล้วย้ายกฎพวกนี้ไปไว้ที่ DTO

## 🟡 ตาราง `water_rates` ว่าง

`GET /water-rates/active` คืน 200 พร้อม body ว่าง ต้องมีอัตราค่าน้ำอย่างน้อย 1 แถวถึงจะคิดบิลได้

---

## ช่องที่ยังหลุดอยู่

- **บ้านที่ยังไม่เคยจดผ่าน OCR ไม่มีจำนวนหลักให้เทียบ** ด่านจำนวนหลักจึงเริ่มทำงานตั้งแต่การจดด้วย OCR ครั้งที่สองเป็นต้นไป — ถ้าอยากให้ครอบตั้งแต่ใบแรก ต้องบันทึกจำนวนหลักตอน `register-onsite` (ด่าน `read_confidence` ครอบตั้งแต่ใบแรกอยู่แล้ว จึงไม่ได้เปิดโล่งสนิท)
- **เกณฑ์ confidence เท่ากันทุกหลัก** — ตอนนี้ใช้ `min` ของทุกหลักเทียบกับ 0.85 ตัวเดียว แต่หลักหน้า (พัน/หมื่น) ผิดแล้วเงินคลาดคนละระดับกับหลักหลัง ควรตั้งเกณฑ์ของหลักหน้าให้สูงกว่า ซึ่งต้องให้ `main.py` ส่ง confidence **แยกรายหลัก** มา ไม่ใช่แค่ค่า min
- **ไม่มีค่าปรับและไม่มีการทบยอด** — `due_date` กับ `Overdue` ทำงานแล้ว แต่บิลที่เลยกำหนดยังคงยอดเดิม ถ้าหมู่บ้านเก็บค่าปรับต้องคิดเองนอกระบบ
- **`markOverdue()` ทำงานตอนอ่านเท่านั้น** ไม่มีใครเปิดหน้าบิลเลยทั้งเดือน สถานะในตารางก็ยังเป็น `Pending` อยู่ — ไม่กระทบยอดเงิน แต่ถ้าวันหลังมีระบบส่ง SMS แจ้งเตือนอัตโนมัติ จะต้องมี scheduler จริง ๆ
- **`period_months` นับจากบิลใบก่อนเท่านั้น** บ้านที่ลงทะเบียนไว้นานแล้วแต่เพิ่งออกบิลใบแรกจะได้ 1 เสมอ ทั้งที่มิเตอร์เดินมาหลายเดือน (ตั้งใจ — ช่วงก่อนมีบิลใบแรกคิดเป็นคาบบิลไม่ได้ และเลขตั้งต้นจาก `register-onsite` ครอบตรงนั้นอยู่แล้ว)

---

## จุดที่มักสะดุด

**`EADDRINUSE: address already in use :::3000`** — `npm run start:dev` แตก process ลูกเป็น `node dist/main` (และ `python.exe` สำหรับ vision service) การกด Ctrl+C หรือปิด terminal บางครั้งฆ่าแค่ตัวแม่ ตัวลูกยังถือพอร์ตอยู่

`prestart` / `prestart:dev` รัน `scripts/free-ports.ts` เคลียร์พอร์ต 3000 กับ 8000 ให้อัตโนมัติทุกครั้งก่อนสตาร์ท ปกติจึงไม่ควรเจอ error นี้ ถ้าอยากเคลียร์เองแยก ๆ ใช้ `npm run free-ports`

**`ไม่พบ JWT_SECRET ใน .env`** — แอปตั้งใจล้มตั้งแต่ตอน boot คัดลอก `.env.example` เป็น `.env` แล้วใส่ค่าสุ่มของตัวเอง

**`Unknown column 'MeterReadingEntity.latitude'`** — ยังไม่ได้รัน `db/migrate-reading-location.sql`

**`Unknown column 'MeterReadingEntity.meter_digits'`** — ยังไม่ได้รัน `db/migrate-meter-digits.sql`

**`Unknown column 'VillageEntity.zip_code'`** — ยังไม่ได้รัน `db/migrate-village-zipcode.sql`

**`Unknown column 'VillageEntity.meter_pitch_m'`** — ยังไม่ได้รัน `db/migrate-village-meter-pitch.sql`

**`Unknown column 'BillEntity.due_date'` / `'BillEntity.period_months'` / `'MeterReadingEntity.read_confidence'` / `'VillageEntity.payment_due_days'`** — ยังไม่ได้รัน `db/migrate-bill-audit.sql`

**ต้องเปิด MySQL ก่อน backend เสมอ** ไม่งั้น TypeORM ต่อไม่ติดตอน bootstrap

**Vision service ใช้เวลาโหลดโมเดลตอนสตาร์ท** ให้รอ `/health` ตอบ 200 ก่อนค่อยยิงงานเข้าไป
