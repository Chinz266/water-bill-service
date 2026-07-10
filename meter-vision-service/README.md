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
  "confidence": 0.91,
  "message": "สกัดค่าตัวเลขสำเร็จ"
}
```

- `read_unit` = ส่วนจำนวนเต็ม (สีดำ) → ค่าที่ NestJS เอาไปคิดบิล
- `decimal_part` = ส่วนทศนิยม (สีแดง)

## Environment variables (ไม่บังคับ)

| ตัวแปร            | ค่าเริ่มต้น | คำอธิบาย                         |
|-------------------|------------|----------------------------------|
| `MODEL_PATH`      | `best.pt`  | path ไฟล์โมเดล                   |
| `IMG_SIZE`        | `800`      | ขนาดภาพที่ป้อนโมเดล (ตอนเทรน 800)|
| `CONF_THRESHOLD`  | `0.35`     | เกณฑ์ความมั่นใจขั้นต่ำ           |
| `PORT`            | `8000`     | พอร์ตที่ service รัน             |
