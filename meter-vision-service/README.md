# Water Meter Vision Service

Python microservice ที่ใช้โมเดล YOLO (`best.pt`) อ่านเลขมิเตอร์น้ำจากรูปภาพ
ใช้แทน Google Cloud Vision OCR เดิมใน `water-bill-service-master`

## ติดตั้ง (ครั้งแรก)

```powershell
cd meter-vision-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## รัน service

```powershell
.\venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000
```

หรือรันตรงๆ: `python main.py`

## Endpoints

| Method | Path      | คำอธิบาย                                    |
|--------|-----------|---------------------------------------------|
| GET    | `/health` | เช็คสถานะ + ดู class ของโมเดล                |
| POST   | `/detect` | อัปโหลดรูป (multipart `file`) คืนเลขมิเตอร์  |

### ตัวอย่างผลลัพธ์ `/detect`

```json
{
  "success": true,
  "read_unit": "00025",
  "integer_part": "00025",
  "decimal_part": "312",
  "full_reading": "00025312",
  "confidence": 0.87,
  "confidence_avg": 0.91,
  "digit_count": 5,
  "message": "สกัดค่าตัวเลขสำเร็จ"
}
```

- `read_unit` = ส่วนจำนวนเต็ม (สีดำ) → ค่าที่ NestJS เอาไปคิดบิล
- `decimal_part` = ส่วนทศนิยม (สีแดง)
- `confidence` = ความมั่นใจของ **หลักที่อ่อนที่สุด** ในส่วนจำนวนเต็ม ไม่ใช่ค่าเฉลี่ย —
  เลขมิเตอร์อ่านผิดหลักเดียวก็ผิดทั้งจำนวน ค่าเฉลี่ยจะกลบหลักที่ไม่ชัดจนมองไม่เห็น
  (ดูค่าเฉลี่ยได้ที่ `confidence_avg`)
- `success: false` เมื่อไม่พบตัวเลข **หรือ** พบแต่ไม่มีหลักจำนวนเต็มเลย —
  กรณีหลังห้ามเดาต่อ เพราะปลายทางคือยอดเงินที่ลูกบ้านต้องจ่าย

### การแบ่งจำนวนเต็ม / ทศนิยม

คลาส `border_decimal_point` คือ **กรอบล้อมส่วนทศนิยม** (เลขสีแดง) ไม่ใช่จุดคั่นเล็ก ๆ
กรอบจึงทับเลขสีแดงเกือบสนิท การแบ่งต้องใช้ **ขอบซ้ายของกรอบ** เท่านั้น
ถ้าใช้จุดกึ่งกลาง เลขสีแดงจะถูกนับเป็นจำนวนเต็มไปด้วย (1009.2 → 10092 = ยอดผิดสิบเท่า)

## Environment variables (ไม่บังคับ)

| ตัวแปร            | ค่าเริ่มต้น | คำอธิบาย                         |
|-------------------|------------|----------------------------------|
| `MODEL_PATH`      | `best.pt`  | path ไฟล์โมเดล                   |
| `IMG_SIZE`        | `800`      | ขนาดภาพที่ป้อนโมเดล (ตอนเทรน 800)|
| `CONF_THRESHOLD`  | `0.35`     | เกณฑ์ความมั่นใจขั้นต่ำ           |
| `PORT`            | `8000`     | พอร์ตที่ service รัน             |
