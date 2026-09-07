import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Per-process limit. Use a shared proxy limit when deploying multiple API instances. */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly windowMs = 60_000;
  private readonly maximum = 20;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    for (const [key, item] of this.attempts) {
      if (item.resetAt <= now) this.attempts.delete(key);
    }
    // Only trust Express's resolved IP; never read X-Forwarded-For directly.
    const key = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    let item = this.attempts.get(key);
    if (!item) {
      if (this.attempts.size >= 10_000) {
        response.setHeader('Retry-After', '60');
        throw new HttpException(
          'มีผู้เข้าสู่ระบบจำนวนมาก กรุณาลองใหม่ในอีก 1 นาที',
          429,
        );
      }
      item = { count: 0, resetAt: now + this.windowMs };
      this.attempts.set(key, item);
    }
    if (++item.count > this.maximum) {
      response.setHeader(
        'Retry-After',
        String(Math.ceil((item.resetAt - now) / 1000)),
      );
      throw new HttpException(
        'ลองเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
        429,
      );
    }
    return true;
  }
}
