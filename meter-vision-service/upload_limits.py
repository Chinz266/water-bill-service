"""Bound request bytes before multipart parsing, including chunked uploads."""
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = 11 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000

from starlette.exceptions import HTTPException


class RequestTooLarge(HTTPException):
    def __init__(self):
        super().__init__(status_code=413, detail="image upload too large")


class UploadLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_REQUEST_BYTES:
                raise RequestTooLarge()
            return message

        try:
            headers = dict(scope.get("headers", []))
            length = headers.get(b"content-length", b"0")
            if length.isdigit() and int(length) > MAX_REQUEST_BYTES:
                raise RequestTooLarge()
            await self.app(scope, limited_receive, send)
        except RequestTooLarge:
            await send({"type": "http.response.start", "status": 413,
                        "headers": [(b"content-type", b"application/json")]})
            await send({"type": "http.response.body", "body": b'{"detail":"image upload too large"}'})
