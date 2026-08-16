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
| PATCH            | `/bills/:id/status`                                                           | `Pending` / `Paid` / `Overdue`               |
| DELETE           | `/bills/:id`                                                                  | บิลที่ `Paid` แล้วลบไม่ได้                   |
| GET/PATCH/DELETE | `/reports`, `/reports/:id`                                                    | เรื่องที่ลูกบ้านแจ้งเข้ามา                   |
| POST/GET         | `/villages`, `/villages/:id`                                                  |                                              |
| POST/GET         | `/water-rates`, `/water-rates/active`                                         |                                              |
| GET              | `/locations/provinces`, `/districts/:provinceId`, `/subdistricts/:districtId` |                                              |

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
