"""
Water Meter Vision Service
==========================
FastAPI microservice ที่โหลดโมเดล YOLO (best.pt) เพื่ออ่านเลขมิเตอร์น้ำจากรูปภาพ
ใช้แทน Google Cloud Vision OCR เดิม

Model classes:
    0-9  = ตัวเลขแต่ละหลัก
    10   = border_decimal_point       (จุดทศนิยม แยกเลขจำนวนเต็ม/ทศนิยม)
    11   = border_water_meter_number  (กรอบล้อมรอบเลขมิเตอร์ทั้งหมด)
"""

import io
import os
import logging

from fastapi import FastAPI, UploadFile, File, HTTPException
from PIL import Image
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("meter-vision")

# --- config ---
MODEL_PATH = os.getenv("MODEL_PATH", "best.pt")
IMG_SIZE = int(os.getenv("IMG_SIZE", "800"))
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.8"))

DIGIT_CLASSES = set(range(10))          # 0-9
CLASS_DECIMAL_POINT = 10
CLASS_METER_BORDER = 11

app = FastAPI(title="Water Meter Vision Service", version="1.0.0")

# โหลดโมเดลครั้งเดียวตอน start service (แพงที่สุด ทำครั้งเดียว)
logger.info(f"Loading YOLO model from '{MODEL_PATH}' ...")
model = YOLO(MODEL_PATH)
logger.info(f"Model loaded. Classes: {model.names}")


def _center(box):
    """คืน (cx, cy) จุดกึ่งกลางของกล่อง (xyxy)"""
    x1, y1, x2, y2 = box
    return (x1 + x2) / 2.0, (y1 + y2) / 2.0


def _inside(cx, cy, border, margin=0.0):
    """เช็คว่าจุด (cx, cy) อยู่ในกรอบ border (xyxy) หรือไม่ (ขยายขอบด้วย margin px ได้)"""
    x1, y1, x2, y2 = border
    return (x1 - margin) <= cx <= (x2 + margin) and (y1 - margin) <= cy <= (y2 + margin)


def parse_reading(result):
    """
    แปลงผลลัพธ์ YOLO เป็นเลขมิเตอร์
    คืน dict: { success, read_unit, integer_part, decimal_part, full_reading, confidence }
    """
    detections = []
    for b in result.boxes:
        cls = int(b.cls[0].item())
        conf = float(b.conf[0].item())
        xyxy = [float(v) for v in b.xyxy[0].tolist()]
        cx, cy = _center(xyxy)
        detections.append({"cls": cls, "conf": conf, "xyxy": xyxy, "cx": cx, "cy": cy})

    # 1) หากรอบเลขมิเตอร์ (border_water_meter_number) ที่มั่นใจสูงสุด
    borders = [d for d in detections if d["cls"] == CLASS_METER_BORDER]
    meter_border = max(borders, key=lambda d: d["conf"]) if borders else None

    # 2) รวบรวมตัวเลข + กรองเฉพาะที่อยู่ในกรอบ (ถ้ามีกรอบ)
    digits = [d for d in detections if d["cls"] in DIGIT_CLASSES]
    if meter_border is not None:
        # margin เผื่อเลขที่ขอบ ~5% ของความสูงกรอบ
        bx1, by1, bx2, by2 = meter_border["xyxy"]
        margin = (by2 - by1) * 0.15
        digits = [d for d in digits if _inside(d["cx"], d["cy"], meter_border["xyxy"], margin)]

    if not digits:
        return {
            "success": False,
            "read_unit": None,
            "integer_part": None,
            "decimal_part": None,
            "full_reading": None,
            "confidence": 0.0,
        }

    # 3) เรียงตัวเลขจากซ้ายไปขวาตามตำแหน่ง x
    digits.sort(key=lambda d: d["cx"])

    # 4) หาจุดทศนิยม (ถ้ามี) เพื่อแยกส่วนจำนวนเต็ม / ทศนิยม
    #    เลือกจุดที่อยู่ในกรอบและมั่นใจสูงสุด
    decimal_points = [d for d in detections if d["cls"] == CLASS_DECIMAL_POINT]
    if meter_border is not None:
        bx1, by1, bx2, by2 = meter_border["xyxy"]
        margin = (by2 - by1) * 0.15
        decimal_points = [
            d for d in decimal_points if _inside(d["cx"], d["cy"], meter_border["xyxy"], margin)
        ]
    decimal_point = max(decimal_points, key=lambda d: d["conf"]) if decimal_points else None

    if decimal_point is not None:
        dp_x = decimal_point["cx"]
        integer_digits = [d for d in digits if d["cx"] < dp_x]
        decimal_digits = [d for d in digits if d["cx"] >= dp_x]
    else:
        # ไม่มีจุดทศนิยม -> ถือว่าทั้งหมดเป็นส่วนจำนวนเต็ม
        integer_digits = digits
        decimal_digits = []

    integer_part = "".join(str(d["cls"]) for d in integer_digits)
    decimal_part = "".join(str(d["cls"]) for d in decimal_digits)
    full_reading = "".join(str(d["cls"]) for d in digits)

    avg_conf = sum(d["conf"] for d in digits) / len(digits)

    # read_unit = ส่วนจำนวนเต็ม (ค่าที่ใช้คิดบิลจริง). ถ้าไม่มีจุดทศนิยมก็ใช้ทั้งหมด
    read_unit = integer_part if integer_part else full_reading

    return {
        "success": bool(read_unit),
        "read_unit": read_unit,
        "integer_part": integer_part or None,
        "decimal_part": decimal_part or None,
        "full_reading": full_reading or None,
        "confidence": round(avg_conf, 4),
    }


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_PATH, "classes": model.names}


@app.post("/detect")
async def detect(file: UploadFile = File(...)):
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid image: {e}")

    results = model.predict(img, imgsz=IMG_SIZE, conf=CONF_THRESHOLD, verbose=False)
    result = results[0]

    parsed = parse_reading(result)

    if parsed["success"]:
        logger.info(
            f"Detected reading: '{parsed['read_unit']}' "
            f"(full: {parsed['full_reading']}, conf: {parsed['confidence']})"
        )
        message = "สกัดค่าตัวเลขสำเร็จ"
    else:
        logger.warning("No digits detected in image")
        message = "วิเคราะห์ภาพแล้ว แต่ไม่พบตัวเลขมิเตอร์ กรุณาถ่ายให้ชัดเจนขึ้น"

    return {**parsed, "message": message}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
