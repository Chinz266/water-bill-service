"""Real FastAPI request parsing and installed YOLO model; no database writes."""
import asyncio
import io
import json
import unittest
from PIL import Image
from main import app, parse_reading, CLASS_DECIMAL_POINT
from upload_limits import MAX_FILE_BYTES, MAX_REQUEST_BYTES


async def request(body, content_type, content_length=True):
    headers = [(b"content-type", content_type.encode())]
    if content_length:
        headers.append((b"content-length", str(len(body)).encode()))
    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "POST", "scheme": "http", "path": "/detect", "raw_path": b"/detect",
             "query_string": b"", "root_path": "", "headers": headers,
             "client": ("127.0.0.1", 1234), "server": ("127.0.0.1", 8000)}
    offset = 0
    messages = []

    async def receive():
        nonlocal offset
        chunk = body[offset:offset + 64 * 1024]
        offset += len(chunk)
        return {"type": "http.request", "body": chunk, "more_body": offset < len(body)}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    data = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return status, json.loads(data)


def multipart(image):
    boundary = "water-bill-test-boundary"
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.jpg"\r\n'
            'Content-Type: image/jpeg\r\n\r\n').encode() + image + f"\r\n--{boundary}--\r\n".encode()
    return body, "multipart/form-data; boundary=" + boundary


class VisionServiceTests(unittest.TestCase):
    def test_invalid_image(self):
        self.assertEqual(asyncio.run(request(*multipart(b"not an image")))[0], 400)

    def test_file_size_limit(self):
        self.assertEqual(asyncio.run(request(*multipart(b"x" * (MAX_FILE_BYTES + 1))))[0], 413)

    def test_request_limit_with_and_without_length(self):
        body, kind = multipart(b"x" * (MAX_REQUEST_BYTES + 1))
        for length in (True, False):
            self.assertEqual(asyncio.run(request(body, kind, length))[0], 413)

    def test_real_model_blank_image_does_not_invent_a_reading(self):
        image = Image.new("RGB", (320, 240), "white")
        file = io.BytesIO()
        image.save(file, format="JPEG")
        status, result = asyncio.run(request(*multipart(file.getvalue())))
        self.assertEqual(status, 200)
        self.assertFalse(result["success"])
        self.assertIsNone(result["read_unit"])

    def test_decimal_digits_are_not_billed_as_integer(self):
        def box(cls, x1, x2, conf=.95):
            return {"cls": cls, "conf": conf, "xyxy": [x1, 10, x2, 30], "cx": (x1+x2)/2, "cy": 20}
        result = parse_reading([box(1, 10, 20), box(2, 30, 40), box(3, 50, 60), box(CLASS_DECIMAL_POINT, 48, 65)], (100, 50))
        self.assertEqual(result["read_unit"], "12")
        self.assertEqual(result["decimal_part"], "3")


if __name__ == "__main__":
    unittest.main()
