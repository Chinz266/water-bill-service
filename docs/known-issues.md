# ปัญหาที่ยังค้าง และจุดที่มักสะดุด

← [กลับหน้าหลัก](../README.md)

## 🔴 อย่าเปิด `synchronize: true`

`app.module.ts` ตั้ง `synchronize: false` ไว้ ถ้าเปิดเป็น `true` TypeORM จะเห็นว่าชื่อคอลัมน์ไม่ตรง (`creat_date` ไม่มี e, `members_id1` มี 1 ต่อท้าย, `craeta_date` / `craete_by` สะกดสลับ) แล้ว **drop คอลัมน์เก่าทิ้งพร้อม FK แล้วสร้างชื่อใหม่** schema จะเพี้ยนจาก `db/water-bill-db.sql` ถาวร

ตาราง `provinces` / `districts` / `subdistricts` มี Entity ใน `src/entity/location.entity.ts` แล้ว จึงต้องควบคุมการเปลี่ยน schema ผ่าน migration เช่นเดียวกับตารางอื่น

## 🟡 การตรวจข้อมูลรองรับ client เดิม

`main.ts` เปิด global `ValidationPipe` และ DTO ตรวจชนิด ช่วงตัวเลข และขนาดข้อความแล้ว ฟิลด์ที่ DTO ไม่ประกาศจะถูกตัดทิ้งแบบไม่ตอบ error เพื่อให้ client รุ่นเก่ายังทำงานได้ Service ยังควรเลือกเฉพาะฟิลด์ที่อนุญาตก่อนเขียนข้อมูลสำคัญ เช่น การสร้างบัญชีผู้ดูแล

## 🟡 ต้องมีอัตราค่าน้ำก่อนออกบิล

ถ้าฐานข้อมูลไม่มีอัตราค่าน้ำที่เปิดใช้งาน จะคิดบิลไม่ได้ ต้องตรวจข้อมูลจริงหลังตั้งระบบ ไม่ควรสรุปว่าตารางว่างจากโค้ดเพียงอย่างเดียว

---

## ช่องที่ยังหลุดอยู่

- **เกณฑ์ confidence เท่ากันทุกหลัก** — ตอนนี้ใช้ `min` ของทุกหลักเทียบกับ 0.85 ตัวเดียว แต่หลักหน้า (พัน/หมื่น) ผิดแล้วเงินคลาดคนละระดับกับหลักหลัง ควรตั้งเกณฑ์ของหลักหน้าให้สูงกว่า ซึ่งต้องให้ `main.py` ส่ง confidence **แยกรายหลัก** มา ไม่ใช่แค่ค่า min
- **ยังไม่มีค่าปรับผิดนัด** — การทบยอดค้างทำแล้ว (`bills.arrears_amount` / `grand_total`) แต่บิลที่เลยกำหนดยังคงยอดเดิม ถ้าหมู่บ้านเก็บค่าปรับต้องคิดเองนอกระบบ
- **จำนวนหลักของบ้านที่ไม่ได้ลงทะเบียนมิเตอร์** — ด่านจำนวนหลักถอยไปใช้ `meters.digits` ได้แล้วเมื่อยังไม่เคยจดผ่าน OCR แต่บ้านที่ยังไม่ลงทะเบียนมิเตอร์ (`POST /meters/register`) ก็ยังไม่มีอะไรให้เทียบในบิลใบแรกอยู่ดี — ด่าน `read_confidence` ครอบตรงนั้นอยู่ จึงไม่ได้เปิดโล่งสนิท
- **`period_months` นับจากบิลใบก่อนเท่านั้น** บ้านที่ลงทะเบียนไว้นานแล้วแต่เพิ่งออกบิลใบแรกจะได้ 1 เสมอ ทั้งที่มิเตอร์เดินมาหลายเดือน (ตั้งใจ — ช่วงก่อนมีบิลใบแรกคิดเป็นคาบบิลไม่ได้ และเลขตั้งต้นจาก `register-onsite` ครอบตรงนั้นอยู่แล้ว)
- **ธงบอกได้แค่ว่า "เคยกดผ่าน" ไม่ได้บอกว่าผิดจริง** — `reading_flags` เป็นข้อมูลดิบให้คนไปอ่าน ไม่มีใครสรุปให้ว่าบ้านไหน/คนไหนน่าสงสัย ถ้าอยากได้ต้องทำหน้าจัดอันดับตามความถี่ต่อคนเพิ่ม (ข้อมูลมีครบแล้ว)
- **บิลที่ออกจาก `POST /bills` (ทางเก่า) ไม่มีธง** — ทางนั้นอ้างการจดที่มีอยู่แล้ว จึงไม่มีจุดให้ติดธงที่เกิดพร้อมกัน ด่านที่บล็อกยังทำงานครบ ต่างแค่ไม่เหลือร่องรอยของการกดผ่าน — ทางที่ควรใช้คือ `POST /bills/scan`

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

**`Unknown column 'MeterReadingEntity.entry_method'` / `'client_uuid'` / `'photo_purged_at'` หรือ `Table 'reading_flags' doesn't exist`** — ยังไม่ได้รัน `db/migrate-reading-audit.sql`

**`Unknown column 'BillEntity.arrears_amount'` / `'grand_total'`** — ยังไม่ได้รัน `db/migrate-bill-arrears.sql`

**`Table 'meters' doesn't exist` / `Unknown column 'MeterReadingEntity.meters_id'`** — ยังไม่ได้รัน `db/migrate-meters.sql`

**`Table 'tenancies' doesn't exist` / `Unknown column 'BillEntity.tenancy_id'`** — ยังไม่ได้รัน `db/migrate-tenancies.sql` (ต้องรันหลัง `migrate-bill-arrears.sql`)

**`Table 'unassigned_readings' doesn't exist`** — ยังไม่ได้รัน `db/migrate-unassigned-readings.sql`

**`Unknown column 'VillageEntity.usage_warn_ratio'` / `'gps_near_m'`** — ยังไม่ได้รัน `db/migrate-village-usage-thresholds.sql`

**ต้องเปิด MySQL ก่อน backend เสมอ** ไม่งั้น TypeORM ต่อไม่ติดตอน bootstrap

**Vision service ใช้เวลาโหลดโมเดลตอนสตาร์ท** ให้รอ `/health` ตอบ 200 ก่อนค่อยยิงงานเข้าไป
