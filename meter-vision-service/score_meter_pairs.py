r"""
คำนวณคะแนนความเหมือนสำหรับการทดลอง "ระบบแยกมิเตอร์ซ้าย/ขวาได้แค่ไหน"
แล้วเขียนลงไฟล์ meter-pair-match-test.xlsx ให้เลย

โครงสร้างโฟลเดอร์รูปที่ต้องเตรียม
---------------------------------
    photos/
      P01/
        L/  L-01.jpg  L-02.jpg ... L-10.jpg      (มิเตอร์ซ้าย)
        R/  R-01.jpg  R-02.jpg ... R-10.jpg      (มิเตอร์ขวา)
      P02/
        ...
      P10/

วิธีรัน
-------
    .\venv\Scripts\Activate.ps1
    python score_meter_pairs.py --photos ..\..\photos --method reading
    python score_meter_pairs.py --photos ..\..\photos --method orb

แล้วเปิด meter-pair-match-test.xlsx ด้วย Excel — สรุปผล (FAR / FRR / Rank-1) จะคำนวณเอง

พิกัด GPS
---------
ทุกครั้งที่รัน สคริปต์จะดึงละติจูด/ลองจิจูดจาก EXIF ของทุกรูปไปเติมแผ่น Photos ให้
แล้วพิมพ์ค่ามัธยฐานของแต่ละมิเตอร์ออกมา เอาไปวางในแผ่น Pairs ได้ถ้าไม่ได้จดหน้างานไว้
ใช้มัธยฐานไม่ใช่ค่าเฉลี่ย เพราะรูปที่ GPS หลุดไปไกลหนึ่งใบจะลากค่าเฉลี่ยไปทั้งชุด

วิธีให้คะแนน 2 แบบ
------------------
reading (ค่าเริ่มต้น)
    ให้ /detect อ่านเลขมิเตอร์จากรูปทั้งสองใบ แล้ววัดว่าเลขที่อ่านได้เหมือนกันแค่ไหน
    ด้วย normalized Levenshtein similarity = 1 - (ระยะแก้ไข / ความยาวที่มากกว่า)
      "00025312" กับ "00025312"  -> 1.000   (ระบบมองเป็นมิเตอร์ตัวเดียวกัน)
      "00025312" กับ "00027845"  -> 0.625   (ต่างกัน 3 หลักจาก 8)
    ใช้ Levenshtein แทนการนับหลักตรงตำแหน่ง เพราะเวลา YOLO อ่านหลุดไปหนึ่งหลัก
    (1250 -> 125) การเทียบทีละตำแหน่งจะพังทั้งสตริง ทั้งที่จริงต่างกันแค่หลักเดียว

    นี่คือแบบที่ตอบโจทย์ระบบคิดบิลตรงที่สุด เพราะ "เลขที่อ่านได้" คือสิ่งเดียวที่ระบบ
    ใช้ระบุว่ารูปนี้เป็นมิเตอร์ของบ้านไหน ถ้าสองบ้านอ่านได้เลขเดียวกัน = บิลไปผิดบ้าน

orb
    เทียบความเหมือนของ "ภาพ" ตรง ๆ ด้วย ORB feature matching (ไม่ใช้ YOLO เลย)
    คะแนน = จำนวน good match / จำนวน keypoint ของรูปที่มี keypoint น้อยกว่า
    ใช้ตอบคำถามว่า "ถ้าไม่ดูตัวเลข ตัวภาพหน้าปัดสองตัวนี้แยกออกจากกันได้ไหม"
    มิเตอร์รุ่นเดียวกันติดกันมักได้คะแนนสูงทั้งคู่ ซึ่งเป็นผลลัพธ์ที่มีความหมาย
    ไม่ใช่ความผิดพลาด — มันแปลว่าลำพังภาพหน้าปัดแยกบ้านไม่ได้ ต้องพึ่งตัวเลข
"""

import argparse
import json
import os
import sys

# ---------------------------------------------------------------- ตำแหน่งใน xlsx
# ต้องตรงกับ layout ที่แผ่น P01–P10 ใน meter-pair-match-test.xlsx
ROW_A = 8    # ตาราง A (ซ้าย x ขวา)      B8:K17
ROW_B = 22   # ตาราง B (ซ้าย x ซ้าย)     B22:K31
ROW_C = 35   # ตาราง C (ขวา x ขวา)       B35:K44
COL0 = 2     # คอลัมน์ B
PHOTO_ROW0 = 4          # แผ่น Photos แถวแรกของข้อมูล
PHOTO_COL_LAT = 6       # F ละติจูด (จาก EXIF)
PHOTO_COL_LON = 7       # G ลองจิจูด (จาก EXIF)
PHOTO_COL_READ = 13     # M read_unit
PHOTO_COL_FULL = 14     # N full_reading
PHOTO_COL_CONF = 15     # O confidence

N = 10       # รูปต่อมิเตอร์
PAIRS = ["P%02d" % i for i in range(1, 11)]
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp", ".bmp")


# ---------------------------------------------------------------- คะแนนแบบ reading
def levenshtein(a, b):
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def reading_similarity(a, b):
    """1.000 = อ่านได้เลขเดียวกัน, 0.000 = ไม่เหมือนเลย หรือมีใบใดใบหนึ่งอ่านไม่ออก"""
    if not a or not b:
        return 0.0
    return round(1.0 - levenshtein(a, b) / max(len(a), len(b)), 3)


# ---------------------------------------------------------------- คะแนนแบบ orb
_orb_cache = {}


def orb_features(path):
    import cv2
    if path in _orb_cache:
        return _orb_cache[path]
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise RuntimeError("เปิดรูปไม่ได้: %s" % path)
    h, w = img.shape
    if max(h, w) > 1000:                       # ย่อให้เร็วขึ้นและคุม keypoint ให้ใกล้กัน
        s = 1000.0 / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    orb = cv2.ORB_create(1500)
    kp, des = orb.detectAndCompute(img, None)
    _orb_cache[path] = (len(kp), des)
    return _orb_cache[path]


def orb_similarity(p1, p2):
    import cv2
    n1, d1 = orb_features(p1)
    n2, d2 = orb_features(p2)
    if d1 is None or d2 is None or n1 < 2 or n2 < 2:
        return 0.0
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    good = 0
    for pair in bf.knnMatch(d1, d2, k=2):
        if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance:
            good += 1
    return round(min(1.0, good / max(1, min(n1, n2))), 3)


# ---------------------------------------------------------------- พิกัดจาก EXIF
def exif_latlon(path):
    """
    ดึงละติจูด/ลองจิจูดที่มือถือฝังไว้ในรูป คืน (lat, lon) หรือ (None, None)

    รูปจะมีพิกัดก็ต่อเมื่อตอนถ่ายเปิด location ให้แอปกล้องไว้ และแอปแชตส่วนใหญ่
    (LINE / Messenger) ลบ EXIF ทิ้งตอนส่ง — ถ้าย้ายรูปมาด้วยการแชตหากัน พิกัดจะหายหมด
    ต้องก๊อปไฟล์ตรงจากเครื่องหรือส่งแบบ "ไฟล์ต้นฉบับ" เท่านั้น
    """
    try:
        from PIL import Image, ExifTags
    except ImportError:
        return None, None
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            if not exif:
                return None, None
            gps_tag = next((k for k, v in ExifTags.TAGS.items() if v == "GPSInfo"), 34853)
            gps = exif.get_ifd(gps_tag)
            if not gps:
                return None, None

            def to_deg(dms, ref, neg):
                d, m, s = (float(x) for x in dms)
                val = d + m / 60.0 + s / 3600.0
                return -val if str(ref).upper() == neg else val

            lat = to_deg(gps[2], gps.get(1, "N"), "S")   # 1=GPSLatitudeRef 2=GPSLatitude
            lon = to_deg(gps[4], gps.get(3, "E"), "W")   # 3=GPSLongitudeRef 4=GPSLongitude
            return round(lat, 6), round(lon, 6)
    except Exception:
        return None, None


# ---------------------------------------------------------------- อ่านเลขมิเตอร์
def make_reader(api_url):
    """คืนฟังก์ชัน path -> dict(read_unit, full_reading, confidence, success)"""
    if api_url:
        import urllib.request
        import mimetypes

        def read_via_api(path):
            boundary = "----meterbound"
            fname = os.path.basename(path)
            ctype = mimetypes.guess_type(fname)[0] or "image/jpeg"
            with open(path, "rb") as fh:
                data = fh.read()
            body = (
                ("--%s\r\n" % boundary).encode()
                + ('Content-Disposition: form-data; name="file"; filename="%s"\r\n' % fname).encode()
                + ("Content-Type: %s\r\n\r\n" % ctype).encode()
                + data
                + ("\r\n--%s--\r\n" % boundary).encode()
            )
            req = urllib.request.Request(
                api_url.rstrip("/") + "/detect",
                data=body,
                headers={"Content-Type": "multipart/form-data; boundary=%s" % boundary},
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())

        return read_via_api

    # โหมด local: import main โดยตรง (โหลด best.pt ตอน import ครั้งเดียว)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from PIL import Image
    from main import read_meter

    def read_local(path):
        with Image.open(path) as im:
            return read_meter(im.convert("RGB"))

    return read_local


# ---------------------------------------------------------------- หาไฟล์รูป
def find_photo(photos_dir, pair, side, idx):
    """หา P01/L/L-01.* — ยอมรับทั้งโฟลเดอร์ย่อย L/R และไฟล์แบนในโฟลเดอร์คู่"""
    stem = "%s-%02d" % (side, idx)
    candidates = [
        os.path.join(photos_dir, pair, side, stem),
        os.path.join(photos_dir, pair, stem),
        os.path.join(photos_dir, pair, side, "%s_%s" % (pair, stem)),
        os.path.join(photos_dir, pair, "%s_%s_%02d" % (pair, side, idx)),
    ]
    for base in candidates:
        for ext in IMG_EXT:
            if os.path.isfile(base + ext):
                # abspath เสมอ เพื่อให้ key ใน cache คงที่ ไม่ว่าจะสั่ง --photos มาแบบไหน
                return os.path.abspath(base + ext)
    return None


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="คำนวณคะแนนความเหมือนแล้วเขียนลง xlsx")
    ap.add_argument("--photos", default="photos", help="โฟลเดอร์รูป (มี P01..P10 ข้างใน)")
    ap.add_argument("--xlsx", default=os.path.join("..", "..", "meter-pair-match-test.xlsx"),
                    help="ไฟล์ Excel ปลายทาง")
    ap.add_argument("--method", choices=["reading", "orb"], default="reading")
    ap.add_argument("--api", default="", help="เช่น http://localhost:8000 (ถ้าไม่ใส่ = โหลดโมเดลเอง)")
    ap.add_argument("--cache", default="readings_cache.json",
                    help="เก็บผลอ่านเลขไว้ รันซ้ำจะไม่ต้องอ่านใหม่ (เฉพาะ method=reading)")
    ap.add_argument("--pairs", default="", help="ทำเฉพาะบางคู่ เช่น P01,P02 (ว่าง = ทั้งหมด)")
    args = ap.parse_args()

    from openpyxl import load_workbook

    if not os.path.isfile(args.xlsx):
        sys.exit("ไม่พบไฟล์ Excel: %s" % os.path.abspath(args.xlsx))
    if not os.path.isdir(args.photos):
        sys.exit("ไม่พบโฟลเดอร์รูป: %s" % os.path.abspath(args.photos))

    pairs = [p.strip().upper() for p in args.pairs.split(",") if p.strip()] or PAIRS

    # ---- 1) เก็บ path ของรูปทั้งหมด ----
    photo = {}
    missing = []
    for pair in pairs:
        for side in ("L", "R"):
            for i in range(1, N + 1):
                p = find_photo(args.photos, pair, side, i)
                if p is None:
                    missing.append("%s/%s-%02d" % (pair, side, i))
                photo[(pair, side, i)] = p
    if missing:
        print("!! ไม่พบรูป %d ใบ:" % len(missing), ", ".join(missing[:12]),
              "..." if len(missing) > 12 else "")
        print("   ช่องที่เกี่ยวข้องจะถูกเว้นว่างไว้ ไม่ถูกนับเป็นผลลัพธ์")

    # ---- 2) อ่านเลขมิเตอร์ (เฉพาะ method=reading) ----
    readings = {}
    if args.method == "reading":
        cache = {}
        if os.path.isfile(args.cache):
            with open(args.cache, encoding="utf-8") as fh:
                cache = json.load(fh)
        todo = [k for k, v in photo.items() if v and v not in cache]
        print("อ่านเลขมิเตอร์ %d ใบ (มีใน cache แล้ว %d ใบ)" % (len(todo), len(cache)))
        # โหลดโมเดลเฉพาะตอนมีรูปที่ยังไม่เคยอ่าน — รันซ้ำจะได้ไม่ต้องรอ best.pt
        reader = make_reader(args.api) if todo else None
        for n, key in enumerate(todo, 1):
            path = photo[key]
            try:
                res = reader(path)
            except Exception as exc:                       # อ่านไม่ออกก็ยังต้องเดินต่อ
                res = {"success": False, "message": str(exc)}
            cache[path] = res
            print("  [%3d/%3d] %s -> %s" % (n, len(todo), os.path.basename(path),
                                            res.get("full_reading") or "อ่านไม่ออก"))
            if n % 20 == 0:
                with open(args.cache, "w", encoding="utf-8") as fh:
                    json.dump(cache, fh, ensure_ascii=False, indent=1)
        with open(args.cache, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, ensure_ascii=False, indent=1)
        for key, path in photo.items():
            res = cache.get(path) or {}
            readings[key] = res.get("full_reading") or "" if res.get("success") else ""
        failed = sum(1 for k in photo if photo[k] and not readings[k])
        if failed:
            print("!! อ่านไม่ออก %d ใบ -> ให้คะแนน 0.000 กับทุกใบที่เทียบด้วย" % failed)

    # ---- 3) ฟังก์ชันให้คะแนน ----
    def score(k1, k2):
        p1, p2 = photo[k1], photo[k2]
        if not p1 or not p2:
            return None
        if args.method == "reading":
            return reading_similarity(readings[k1], readings[k2])
        return orb_similarity(p1, p2)

    # ---- 4) คำนวณและเขียนลง xlsx ----
    wb = load_workbook(args.xlsx)
    for pair in pairs:
        ws = wb[pair]
        # ตาราง A: ซ้าย x ขวา (ไม่สมมาตร ต้องคิดครบ 100 ช่อง)
        for i in range(N):
            for j in range(N):
                ws.cell(row=ROW_A + i, column=COL0 + j).value = \
                    score((pair, "L", i + 1), (pair, "R", j + 1))
        # ตาราง B และ C: สมมาตร คิดครึ่งบนแล้วมิเรอร์ เส้นทแยงมุมเว้นว่าง
        for row0, side in ((ROW_B, "L"), (ROW_C, "R")):
            for i in range(N):
                for j in range(i + 1, N):
                    v = score((pair, side, i + 1), (pair, side, j + 1))
                    ws.cell(row=row0 + i, column=COL0 + j).value = v
                    ws.cell(row=row0 + j, column=COL0 + i).value = v
        print("เขียนแล้ว: %s" % pair)

    # ---- 5) เติมพิกัด EXIF และเลขที่อ่านได้ลงแผ่น Photos ----
    cache = {}
    if args.method == "reading" and os.path.isfile(args.cache):
        with open(args.cache, encoding="utf-8") as fh:
            cache = json.load(fh)
    ps = wb["Photos"]
    coords = {}
    with_gps = 0
    r = PHOTO_ROW0
    for pair in PAIRS:
        for side in ("L", "R"):
            for i in range(1, N + 1):
                path = photo.get((pair, side, i))
                if path:
                    lat, lon = exif_latlon(path)
                    if lat is not None:
                        ps.cell(row=r, column=PHOTO_COL_LAT).value = lat
                        ps.cell(row=r, column=PHOTO_COL_LON).value = lon
                        coords.setdefault((pair, side), []).append((lat, lon))
                        with_gps += 1
                    res = cache.get(path)
                    if res:
                        ps.cell(row=r, column=PHOTO_COL_READ).value = res.get("read_unit")
                        ps.cell(row=r, column=PHOTO_COL_FULL).value = res.get("full_reading")
                        ps.cell(row=r, column=PHOTO_COL_CONF).value = res.get("confidence")
                r += 1

    if with_gps:
        print("\nพบพิกัดใน EXIF %d รูป — เติมลงแผ่น Photos แล้ว" % with_gps)
        print("ค่ามัธยฐานของแต่ละมิเตอร์ (ก๊อปไปวางในแผ่น Pairs ได้เลย ถ้าไม่ได้จดพิกัดหน้างานไว้):")
        for pair in PAIRS:
            for side in ("L", "R"):
                pts = coords.get((pair, side))
                if not pts:
                    continue
                lats = sorted(p[0] for p in pts)
                lons = sorted(p[1] for p in pts)
                mid = len(pts) // 2
                print("  %s %s  %.6f, %.6f  (จาก %d รูป)"
                      % (pair, side, lats[mid], lons[mid], len(pts)))
    else:
        print("\nไม่พบพิกัดใน EXIF สักรูป — ต้องจดพิกัดหน้างานแล้วกรอกในแผ่น Pairs เอง")
        print("(มือถือต้องเปิด location ตอนถ่าย และห้ามส่งรูปผ่าน LINE/Messenger เพราะจะโดนลบ EXIF)")

    wb.save(args.xlsx)
    print("\nบันทึกลง %s แล้ว" % os.path.abspath(args.xlsx))
    print("เปิดด้วย Excel ได้เลย — FAR / FRR / Rank-1 และแผ่น Summary จะคำนวณเองตอนเปิด")


if __name__ == "__main__":
    main()
