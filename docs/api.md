# API

← [กลับหน้าหลัก](../README.md)

Swagger อยู่ที่ `http://localhost:3000/api` — ตารางนี้ไว้ดูภาพรวม

## แอดมิน

| Method           | Path                                                                          | หมายเหตุ                                     |
| ---------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| POST             | `/auth/register`, `/auth/login`                                               | `@Public()`                                  |
| GET              | `/auth/me`                                                                    | เช็คว่า token ยังใช้ได้ไหม                   |
| POST             | `/member/all`, `/find-one`, `/create`, `/update`, `/remove`                   |                                              |
| POST             | `/member/register-onsite`                                                     | **ลงทะเบียนบ้านแบบยืนที่มิเตอร์ (แนะนำ)**    |
| POST             | `/admin/all`, `/find-one`, `/create`, `/update`, `/remove`                    |                                              |
| POST/GET         | `/meter-readings`, `/meter-readings/member/:memberId`                         |                                              |
| POST             | `/meter-readings/ocr-upload`                                                  | อัปรูป 1 ใบ → เรียก vision service           |
| POST             | `/bills`                                                                      | สร้างบิลจากเลขที่กรอกเอง                     |
| POST             | `/bills/scan`                                                                 | **จดมิเตอร์ + ออกบิล ในทรานแซกชันเดียว**     |
| POST             | `/bills/scan-batch`                                                           | **อัปรูปหลายใบ → เดาว่าใบไหนของบ้านไหน**     |
| GET              | `/bills`, `/bills/:id`                                                        |                                              |
| GET              | `/bills/member/:membersId/month?month=&year=`                                 | บ้านนี้มีบิลเดือนนี้แล้วหรือยัง (null = ยัง) |
| GET              | `/bills/member/:membersId/previous?month=&year=`                              | เลขตั้งต้นที่จะใช้คิดหน่วยน้ำ                |
| POST             | `/bills/:id/pay`                                                              | **รับชำระเงิน — ปิดใบเก่าที่ถูกทบยอดพร้อมกัน** |
| PATCH            | `/bills/:id/reading`                                                          | **แก้เลขมิเตอร์ของบิลที่ออกแล้ว** (multipart) |
| PATCH            | `/bills/:id/status`                                                           | `Pending` / `Paid` / `Overdue` — ⚠️ อย่าใช้รับเงิน |
| DELETE           | `/bills/:id`                                                                  | บิลที่ `Paid` แล้วลบไม่ได้                   |
| GET/POST         | `/meters/member/:membersId`, `/meters/register`                               | ทะเบียนมิเตอร์ของบ้าน                        |
| POST             | `/meters/replace`                                                             | **เปลี่ยนมิเตอร์ — หน่วยค้างเข้าบิลถัดไปเอง** |
| GET/POST         | `/tenancies/member/:membersId`, `/tenancies/start`                            | ผู้อยู่อาศัยแต่ละช่วง                        |
| POST             | `/tenancies/move-out`                                                         | **ย้ายออก — จดครั้งสุดท้าย + ออกบิลปิดยอด**   |
| GET/POST         | `/readings/unassigned`                                                        | คิวรูปที่ยังไม่รู้ว่าของบ้านไหน               |
| GET              | `/readings/unassigned/:id?month=&year=`                                       | รูปหนึ่งใบ + บ้านที่เป็นไปได้ 5 อันดับ        |
| POST             | `/readings/unassigned/:id/assign`, `/discard`                                 | จับคู่แล้วออกบิล / ตีทิ้ง                     |
| GET              | `/audit/flags`, `/audit/flags/summary?days=`                                  | ธงที่ระบบติดไว้ตอนกดข้ามด่าน                  |
| GET              | `/audit/reading-logs?bills_id=&limit=`                                        | ประวัติการแก้เลขมิเตอร์หลังออกบิล             |
| GET/POST         | `/audit/housekeeping`, `/audit/housekeeping/run`                              | งานเก็บกวาด (ดูก่อน แล้วค่อยสั่งรัน)          |
| GET/PATCH/DELETE | `/reports`, `/reports/:id`                                                    | เรื่องที่ลูกบ้านแจ้งเข้ามา                   |
| POST/GET         | `/villages`, `/villages/:id`                                                  |                                              |
| POST/GET         | `/water-rates`, `/water-rates/active`                                         |                                              |
| GET              | `/locations/provinces`, `/districts/:provinceId`, `/subdistricts/:districtId` |                                              |

### แก้เลขมิเตอร์ของบิลที่ออกไปแล้ว — `PATCH /bills/:id/reading`

`multipart/form-data`: `current_unit`, `reason` (บังคับ), `photo` (ไฟล์, ไม่บังคับ), `confirm_high_usage`, `confirm_meter_reset`
คืน `{ usage_unit, total_amount, grand_total }`

| สิทธิ์ (`admin_role` ใน token) | แก้ได้เมื่อ                                       |
| ------------------------------ | ------------------------------------------------- |
| `owner`                        | ตลอด ยกเว้นบิลที่ `Paid`                          |
| `staff`                        | บิลที่ **จดวันนี้** หรือบิลที่ยังเป็น `Pending`    |

- บิลที่ `Paid` แก้ไม่ได้แม้เป็น `owner` → ต้อง `PATCH /bills/:id/status` กลับเป็น `Pending` ก่อน (ตอบ 409 `code: BILL_PAID`)
- ติดด่านตอบ **400** พร้อม `{ message, code: 'high_usage' | 'meter_reset' }` — หน้าเว็บอ่าน `code` เพื่อเปิดปุ่มยืนยัน แล้วยิงซ้ำพร้อม `confirm_*` **เฉพาะรอบนั้น** (ห้ามติ๊กล่วงหน้า) error ที่ไม่มี `code` = error ธรรมดา ห้ามขึ้นปุ่มให้กดข้าม
- รูปที่แนบมาถูกครอปจากหน้าเว็บแล้วจึงไม่มี EXIF — ระบบ **ไม่เอาไปอัปเดตพิกัด/เวลาถ่าย** ของการจดครั้งนั้น
- แก้สำเร็จให้โหลดประวัติบิลใหม่ทั้งชุด: ยอดค้างที่ใบอื่นทบใบนี้ไว้ (`arrears_amount` / `grand_total`) ถูกคิดใหม่ตามไปด้วย
- ทุกครั้งที่แก้จะมีแถวลง `meter_reading_logs` (เลขเดิม/ใหม่ ยอดเดิม/ใหม่ เหตุผล ใครแก้) ดูผ่าน `GET /audit/reading-logs?bills_id=`

## พอร์ทัลลูกบ้าน — `/me/*`

| Method   | Path          | หมายเหตุ                                    |
| -------- | ------------- | ------------------------------------------- |
| GET      | `/me/houses`  | บ้านที่บัญชีนี้ผูกไว้                       |
| GET      | `/me/bills`   | บิลของบ้านตัวเองเท่านั้น                    |
| GET      | `/me/admins`  | เบอร์ติดต่อผู้ดูแล                          |
| GET/POST | `/me/reports` | แจ้งเรื่อง / ดูเรื่องที่เคยแจ้ง (แนบรูปได้) |

`memberIds` ที่ใช้กรองมาจากตาราง `account_members` ของ token ที่ล็อกอินอยู่ ไม่ได้รับจาก body — ลูกบ้านจึงยิงดูบิลบ้านคนอื่นไม่ได้

---

## Vision service — `http://localhost:8000`

| Method | Path      | หมายเหตุ                                                 |
| ------ | --------- | -------------------------------------------------------- |
| GET    | `/health` | เช็คสถานะ + ดู class ของโมเดล                            |
| POST   | `/detect` | อัปโหลดรูป (multipart field ชื่อ `file`) → คืนเลขมิเตอร์ |

โมเดลมี 12 class: `0`–`9` คือตัวเลขแต่ละหลัก, `10` = `border_decimal_point`, `11` = `border_water_meter_number`

```json
{
  "success": true,
  "read_unit": "00025",
  "integer_part": "00025",
  "decimal_part": "312",
  "full_reading": "00025312",
  "confidence": 0.91
}
```

`POST /meter-readings/ocr-upload` คืนผลชุดนี้ต่อให้หน้าเว็บ พร้อม `meter_digits` (จำนวนหลักที่นับจาก `integer_part`) และ `photo_taken` (EXIF) ที่ backend เติมให้ — **หน้าเว็บต้องส่ง `meter_digits` ต่อไปกับ `POST /bills/scan`** ไม่งั้นด่านจำนวนหลักจะไม่ทำงาน

> ⚠️ **backend ใช้ `integer_part` เท่านั้น** — เลขสีดำบนหน้าปัด (ลูกบาศก์เมตร)
> `full_reading` รวมเลขทศนิยม (เข็มแดง) มาด้วย มิเตอร์ที่อ่านได้ 25.312 จะกลายเป็น 25312 ใหญ่เกินจริง 1,000 เท่า
> ตัวเลขนี้ถูกส่งต่อเป็น `current_unit` ตรง ๆ อ่านผิดจึงเท่ากับยอดเงินผิดทันที

Vision service ใช้เวลาโหลดโมเดลตอนสตาร์ท — รอ `/health` ตอบ 200 ก่อนค่อยยิงงานเข้าไป
