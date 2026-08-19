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
# 0.35 ตามที่ README ระบุไว้แต่แรก — เคยถูกดันขึ้นเป็น 0.8 ซึ่งอันตรายกว่าที่คิด:
# หลักที่เบลอ/สะท้อนแสงจะถูกทิ้งเงียบ ๆ เลขเลยหายไปหนึ่งหลัก (1250 → 125)
# แล้วหลักที่เหลือทุกตัวมั่นใจ ≥ 0.8 หมด ค่า confidence ที่รายงานจึงสูงตลอด
# กลายเป็นอ่านผิดแบบยอดคลาด 10 เท่าโดยที่หน้าจอขึ้นว่า "อ่านได้ชัดเจน"
CONF_THRESHOLD = float(os.getenv("CONF_THRESHOLD", "0.35"))

DIGIT_CLASSES = set(range(10))          # 0-9
CLASS_DECIMAL_POINT = 10
CLASS_METER_BORDER = 11

# เผื่อด้านข้างของกรอบที่เสนอให้ครอป — สัดส่วนของกล่องเอง ไม่ใช่ของทั้งภาพ
#
# 3.0 ต่อข้าง = กรอบกว้างราวเจ็ดเท่าของแถวตัวเลข ซึ่งบนรูปที่ถ่ายห่างปกติจะชนขอบภาพ
# แล้วถูกหด (ดู clamp ข้างล่าง) กลายเป็น "เต็มความกว้างภาพ สูงตาม 3:1" — คือกรอบที่
# คนหน้างานลากเองแล้วยืนยันว่าโมเดลอ่านออก
#
# ตั้งเผื่อไว้ให้ชนขอบโดยตั้งใจ เพราะระยะห่างตอนถ่ายไม่คงที่: มิเตอร์ที่ถ่ายใกล้จนเต็มเฟรม
# กับถ่ายห่างจนหน้าปัดเหลือครึ่งเฟรม ให้แถวตัวเลขขนาดต่างกันหลายเท่า ค่าที่พอดีกับรูปใกล้
# จะแคบเกินไปทันทีบนรูปไกล — ฝั่งกว้างเกินยังมีขอบภาพคอยหยุดให้ ฝั่งแคบเกินไม่มีอะไรกัน
CROP_PAD_X = 3.0

# สัดส่วนกว้าง:สูง ของกรอบที่คืนไป — ต้องตรงกับ ratio ที่ meter-cropper บนแอปล็อกไว้
#
# แอปล็อก 3:1 เป็นค่าเริ่มต้น (เลือก 4:1 ได้) กรอบที่ส่งไปเป็นสัดส่วนอื่นจึงถูก
# ngx-image-cropper บิดให้เข้า ratio ทันทีที่ตั้ง — กรอบที่คนเห็นจะไม่ใช่กรอบที่คำนวณไว้
# คุมความสูงที่นี่เองจึงได้กรอบที่ตั้งใจจริง ๆ และไม่ต้องมีค่า pad แนวตั้งแยกอีกตัว
CROP_ASPECT = 3.0

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


def _x_overlap_ratio(a, b):
    """สัดส่วนที่สองกล่องทับกันในแนวนอน เทียบกับกล่องที่แคบกว่า (0 = ไม่ทับเลย)"""
    left = max(a["xyxy"][0], b["xyxy"][0])
    right = min(a["xyxy"][2], b["xyxy"][2])
    if right <= left:
        return 0.0
    narrower = min(a["xyxy"][2] - a["xyxy"][0], b["xyxy"][2] - b["xyxy"][0])
    return (right - left) / narrower if narrower > 0 else 0.0


def _dedupe_digits(digits, overlap_ratio=0.5):
    """
    เลขหลักเดียวกันที่ถูกตรวจเจอซ้อนกันหลายคลาส ให้เหลือตัวที่มั่นใจสุดตัวเดียว

    YOLO ทำ NMS แยกตามคลาส หลักเดียวกันจึงโผล่ได้พร้อมกันสองคลาส (เช่น '8' กับ '3')
    ถ้าปล่อยไว้ เลขจะยาวเกินจริงหนึ่งหลัก = ยอดเงินผิดสิบเท่า

    ทำเองแทนการเปิด agnostic_nms เพราะคลาส border_* ถูกออกแบบมาให้ทับกับตัวเลขอยู่แล้ว
    (กรอบทศนิยมทับเลขสีแดงเกือบสนิท) เปิด agnostic NMS เมื่อไหร่กรอบพวกนั้นจะถูกกลืนหายไป
    """
    kept = []
    for digit in sorted(digits, key=lambda d: -d["conf"]):
        if not any(_x_overlap_ratio(digit, k) > overlap_ratio for k in kept):
            kept.append(digit)
    return kept


def _hull(boxes):
    """กรอบที่ครอบทุกกล่องในลิสต์ (xyxy) — ลิสต์ว่างคืน None"""
    if not boxes:
        return None
    return [
        min(b["xyxy"][0] for b in boxes),
        min(b["xyxy"][1] for b in boxes),
        max(b["xyxy"][2] for b in boxes),
        max(b["xyxy"][3] for b in boxes),
    ]


def _crop_box(integer_digits, meter_border, size):
    """
    กรอบเริ่มต้นที่จะส่งไปตั้งให้ ngx-image-cropper บนแอป (auto-crop)

    ═══ ทำไมเอาจากหลักจำนวนเต็มก่อน ไม่ใช่กรอบ border ═══

    border_water_meter_number ครอบ "เลขมิเตอร์ทั้งแถบ" ซึ่งรวมเลขทศนิยมสีแดงเข้ามาด้วย
    ตั้งกรอบตามนั้นแล้วคนกดยืนยันต่อทันที = ครอปติดเลขแดง ซึ่งเป็นความผิดพลาดที่ทำให้
    ยอดคลาด 1,000 เท่า (25.312 -> 25312) และเป็นสิ่งที่หน้าจอบนแอปเตือนไว้ทุกครั้ง
    กรอบที่ตั้งให้เองจึงต้องเป็นกรอบของ "เลขสีดำเท่านั้น" ให้ตรงกับที่สอนคนทำ

    ถอยไปใช้ border เมื่ออ่านหลักจำนวนเต็มไม่ได้เลย — ตอนนั้นข้อมูลที่แม่นกว่าไม่มีแล้ว
    และการมีกรอบคร่าว ๆ ให้ลากต่อยังดีกว่าโยนกรอบกลางภาพให้

    ═══ กรอบที่คืนกว้างเต็มภาพเกือบทุกครั้ง และเป็น 3:1 เสมอ ═══

    ขยายออกด้านข้างด้วย CROP_PAD_X แล้วคุมความสูงด้วย CROP_ASPECT ไม่ใช่ด้วย pad แนวตั้ง —
    เพราะแอปล็อก ratio ไว้ กรอบสัดส่วนอื่นจะถูกบิดทิ้งทันทีที่ตั้ง กรอบที่คำนวณไว้จึงต้อง
    เป็นสัดส่วนเดียวกับที่แอปใช้ตั้งแต่แรก

    ผลที่ได้คือแถบแนวนอนเต็มความกว้างภาพ วางกลางที่แถวตัวเลข — ตรงกับกรอบที่คนหน้างาน
    ลากเองแล้วยืนยันว่าโมเดลอ่านออก งานของกรอบนี้จึงเป็นการ **ตัดส่วนบน/ล่างที่ไม่เกี่ยว
    ออกไป** ไม่ใช่การซูมเข้าไปที่ตัวเลข

    ⚠️ อย่าลดให้กรอบแนบขอบเลข — รอบสองจะเหลือแต่ตัวเลขลอย ๆ ไม่มีหน้าปัดให้อ้างอิงว่า
       แถวเลขอยู่ตรงไหน ใครจะขยับค่าต้องมีรูปหน้างานยืนยันก่อนว่าอ่านได้ดีขึ้นจริง

    ⚠️ พิกัดที่คืนเป็นของ "ภาพตามที่เก็บในไฟล์" — PIL ไม่หมุนภาพตาม EXIF Orientation ให้
       รูปจากมือถือที่ถ่ายแนวตั้งจะมีกรอบเอียง 90 องศาเทียบกับที่คนเห็นบนจอ
       ฝั่งแอปต้องหมุนกรอบตาม EXIF ก่อนใช้เสมอ (ดู mapBoxThroughExif ใน meter-cropper.ts)

    คืน None เมื่อไม่มีอะไรให้ชี้ — แอปจะใช้กรอบกลางภาพตามเดิม
    """
    box = _hull(integer_digits)
    if box is None and meter_border is not None:
        box = meter_border["xyxy"]
    if box is None:
        return None

    width, height = size
    if width <= 0 or height <= 0:
        return None

    x1, y1, x2, y2 = box
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0

    box_w = (x2 - x1) * (1.0 + 2.0 * CROP_PAD_X)
    box_h = box_w / CROP_ASPECT

    # ภาพที่เล็กกว่ากรอบ (หรือแคบกว่า ratio) ต้องหดทั้งคู่พร้อมกัน ไม่งั้นสัดส่วนเพี้ยน
    if box_w > width:
        box_w, box_h = width, width / CROP_ASPECT
    if box_h > height:
        box_w, box_h = height * CROP_ASPECT, height

    # เลื่อนกรอบเข้ามาในภาพแทนการเฉือน — เฉือนแล้วสัดส่วนจะไม่ใช่ CROP_ASPECT อีก
    # ซึ่งพาไปจบที่ปัญหาเดิมคือแอปบิดกรอบทิ้งตอนตั้ง
    left_px = min(max(cx - box_w / 2.0, 0.0), width - box_w)
    top_px = min(max(cy - box_h / 2.0, 0.0), height - box_h)

    left, top = left_px / width, top_px / height
    right, bottom = (left_px + box_w) / width, (top_px + box_h) / height

    if right <= left or bottom <= top:
        return None

    return {
        "x": round(left, 5),
        "y": round(top, 5),
        "w": round(right - left, 5),
        "h": round(bottom - top, 5),
        "source": "digits" if integer_digits else "border",
    }


def parse_reading(detections, size):
    """
    แปลงกล่องที่โมเดลตรวจเจอเป็นเลขมิเตอร์
    คืน dict: { success, read_unit, integer_part, decimal_part, full_reading, confidence }
    """
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
            "confidence_avg": 0.0,
            "digit_count": 0,
            # อ่านเลขไม่ได้ แต่ถ้าเห็นกรอบมิเตอร์ก็ยังชี้ที่ให้ครอปต่อได้
            "crop_box": _crop_box(None, meter_border, size),
        }

    # 2.5) ตัดหลักที่ตรวจเจอซ้อนกันเองออกก่อน ไม่งั้นเลขจะยาวเกินจริง
    digits = _dedupe_digits(digits)

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
        # ⚠️ ต้องแบ่งด้วย "ขอบซ้าย" ของกรอบทศนิยม ไม่ใช่จุดกึ่งกลาง
        #
        # คลาสนี้ชื่อ border_decimal_point — มันคือ "กรอบล้อมส่วนทศนิยม" (เลขสีแดง)
        # ไม่ใช่จุดเล็ก ๆ ที่คั่นกลาง กรอบจึงทับเลขสีแดงเกือบสนิท และจุดกึ่งกลางของกรอบ
        # เกือบตรงกับจุดกึ่งกลางของเลขสีแดงพอดี
        #
        # ของเดิมแบ่งด้วยจุดกึ่งกลาง (d["cx"] < dp_cx) เลขสีแดงที่ศูนย์กลางบังเอิญอยู่
        # ซ้ายกว่าศูนย์กลางกรอบแค่เศษพิกเซล จึงถูกนับเป็นจำนวนเต็มไปด้วย:
        # มิเตอร์ที่อ่านได้ 1009.2 กลายเป็น 10092 — ยอดเงินผิดสิบเท่าทุกใบที่มีเลขแดง
        #
        # ใช้ขอบซ้ายแทน ถูกต้องทั้งสองแบบ: ถ้าเป็นกรอบ เลขแดงทุกตัวจะอยู่ในกรอบ
        # และถ้าวันหลังโมเดลตรวจเป็นจุดจริง ๆ กล่องจะแคบจนขอบซ้าย ≈ ตำแหน่งจุด
        dp_x = decimal_point["xyxy"][0]
        integer_digits = [d for d in digits if d["cx"] < dp_x]
        decimal_digits = [d for d in digits if d["cx"] >= dp_x]
    else:
        # ไม่มีจุดทศนิยม -> ถือว่าทั้งหมดเป็นส่วนจำนวนเต็ม
        integer_digits = digits
        decimal_digits = []

    integer_part = "".join(str(d["cls"]) for d in integer_digits)
    decimal_part = "".join(str(d["cls"]) for d in decimal_digits)
    full_reading = "".join(str(d["cls"]) for d in digits)

    # ความมั่นใจของ "เลขทั้งจำนวน" = หลักที่อ่อนที่สุด ไม่ใช่ค่าเฉลี่ย
    #
    # เลขมิเตอร์อ่านผิดหลักเดียวก็ผิดทั้งจำนวน ค่าเฉลี่ยจะกลบหลักที่ไม่ชัดจนมองไม่เห็น
    # (สี่หลักที่ 0.99 กับอีกหลักที่ 0.41 เฉลี่ยได้ 0.87 = "อ่านได้ชัดเจน" ทั้งที่มีหลักน่าสงสัย)
    # ส่งค่าเฉลี่ยไปด้วยเผื่อใช้ดูภาพรวม แต่ตัวที่หน้าเว็บเอาไปเตือนคนต้องเป็นตัวที่อ่อนที่สุด
    confs = [d["conf"] for d in integer_digits] or [d["conf"] for d in digits]
    min_conf = min(confs)
    avg_conf = sum(confs) / len(confs)

    # read_unit = ส่วนจำนวนเต็ม (เลขสีดำ = ลูกบาศก์เมตร) เท่านั้น — ค่าที่เอาไปคิดบิลจริง
    #
    # ของเดิมถ้าไม่มีหลักจำนวนเต็มเลยจะถอยไปใช้ full_reading ซึ่งรวมเลขสีแดงเข้ามาด้วย
    # เท่ากับคืนเลขที่ใหญ่เกินจริงสิบเท่าออกไปเงียบ ๆ ในจังหวะที่ระบบสับสนที่สุด
    # ตอบว่าอ่านไม่ได้ตรง ๆ ดีกว่า เพราะปลายทางคือยอดเงินที่ลูกบ้านต้องจ่าย
    read_unit = integer_part or None

    return {
        "success": bool(read_unit),
        "read_unit": read_unit,
        "integer_part": integer_part or None,
        "decimal_part": decimal_part or None,
        "full_reading": full_reading or None,
        "confidence": round(min_conf, 4),
        "confidence_avg": round(avg_conf, 4),
        "digit_count": len(integer_digits),
        "crop_box": _crop_box(integer_digits, meter_border, size),
    }


def read_meter(image):
    """
    อ่านเลขมิเตอร์จากรูปหนึ่งใบ

    ⚠️ เคยลองเพิ่มความแม่นด้วย 3 วิธีมาตรฐานแล้ว **ไม่ได้ผล** วัดจากรูปจริงที่ทำให้แย่ลง
    13 แบบ (ย่อ/เบลอ/เอียง/มืด/ย้อนแสง/JPEG คุณภาพต่ำ) ทุกวิธีได้ 9/13 เท่ากันหมด:

      1. ครอปหน้าปัดแล้วขยายอ่านซ้ำ (two-pass) — ไม่ช่วยเลย ทั้งยังทำให้สองรอบ
         อ่านไม่ตรงกันบ่อยขึ้นจาก 4 เป็น 9 เคส (เตือนหลอกคนตรวจ) และช้าขึ้นเท่าตัว
         ซึ่งเจ็บมากตอนอ่านทีละ 30 ใบ — ซูมมากเกินไปทำให้ตัวเลขใหญ่กว่าตอนเทรน
      2. TTA (`augment=True`) — โมเดลนี้ไม่รองรับ ultralytics เตือนแล้วถอยไปอ่านแบบปกติ
      3. หมุนภาพให้แถวตัวเลขตรงก่อนอ่าน — ได้ 9/13 เท่าเดิม แต่ย้ายตัวที่ผิดไปเป็นคนละใบ

    ความแม่นของการอ่านดิบ ๆ ติดที่ตัวโมเดล (best.pt) ไม่ใช่โค้ดตรงนี้ ถ้าจะให้แม่นกว่านี้
    ต้องเทรนใหม่ด้วยรูปที่เบลอ/เอียง/ถ่ายไกลเพิ่ม อย่าเสียเวลาแก้ pipeline ซ้ำ

    สิ่งที่ทำได้จริงคือ "อย่าให้ตัวที่อ่านผิดหลุดไปเป็นบิลเงียบ ๆ" — ค่า confidence
    จึงรายงานหลักที่อ่อนที่สุด ซึ่งจับตัวที่อ่านผิดได้ครบทั้ง 4/4 เคสในชุดทดสอบ
    (ทุกตัวได้ต่ำกว่า 0.85 ซึ่งเป็นเกณฑ์ที่หน้าเว็บใช้ขึ้นคำเตือน)
    """
    result = model.predict(image, imgsz=IMG_SIZE, conf=CONF_THRESHOLD, verbose=False)[0]

    detections = []
    for b in result.boxes:
        xyxy = [float(v) for v in b.xyxy[0].tolist()]
        cx, cy = _center(xyxy)
        detections.append(
            {
                "cls": int(b.cls[0].item()),
                "conf": float(b.conf[0].item()),
                "xyxy": xyxy,
                "cx": cx,
                "cy": cy,
            }
        )

    return parse_reading(detections, image.size)


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

    parsed = read_meter(img)

    if parsed["success"]:
        logger.info(
            f"Detected reading: '{parsed['read_unit']}' "
            f"(full: {parsed['full_reading']}, decimal: {parsed['decimal_part']}, "
            f"conf min: {parsed['confidence']} avg: {parsed['confidence_avg']})"
        )
        message = "สกัดค่าตัวเลขสำเร็จ"
    elif parsed["full_reading"]:
        # เจอตัวเลขแต่ตกไปอยู่ในส่วนทศนิยมหมด — เดาต่อไม่ได้ว่าเลขจำนวนเต็มคือเท่าไหร่
        logger.warning(f"Digits found but no integer part (full: {parsed['full_reading']})")
        message = "อ่านเลขได้ไม่ครบ (ไม่พบเลขส่วนจำนวนเต็ม) กรุณาถ่ายให้เห็นเลขสีดำทั้งแถว"
    else:
        logger.warning("No digits detected in image")
        message = "วิเคราะห์ภาพแล้ว แต่ไม่พบตัวเลขมิเตอร์ กรุณาถ่ายให้ชัดเจนขึ้น"

    return {**parsed, "message": message}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
