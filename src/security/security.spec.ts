import {
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  FilesInterceptor,
  NestExpressApplication,
} from '@nestjs/platform-express';
import { configureApp } from '../app.setup';
import { AuthLoginDto } from '../dto/auth-login.dto';
import { AuthRegisterDto } from '../dto/auth-register.dto';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import {
  imageUploadOptions,
  MAX_BATCH_BYTES,
  MAX_IMAGE_BYTES,
  validateImage,
} from './upload';
import sharp from 'sharp';

@Controller()
class TestController {
  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() body: AuthLoginDto) {
    return { email: body.email };
  }

  @Post('register')
  register(@Body() body: AuthRegisterDto) {
    return body;
  }

  @Post('images')
  @UseInterceptors(FilesInterceptor('files', 30, imageUploadOptions))
  async images(@UploadedFiles() files: Express.Multer.File[]) {
    for (const file of files) await validateImage(file);
    return { count: files.length };
  }
}

describe('HTTP input boundaries', () => {
  let app: NestExpressApplication;
  let base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TestController],
      providers: [LoginRateLimitGuard],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
  });
  const json = (path: string, body: unknown) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const upload = (buffers: Buffer[]) => {
    const form = new FormData();
    for (const buffer of buffers)
      form.append(
        'files',
        new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }),
        'image.jpg',
      );
    return fetch(base + '/images', { method: 'POST', body: form });
  };

  it('rejects wrong types and invalid credentials before the controller', async () => {
    expect((await json('/login', { email: {}, password: [] })).status).toBe(
      400,
    );
    expect(
      (
        await json('/register', {
          fname: ' ',
          lname: 'x',
          email: 'bad',
          password: 'short',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await json('/register', {
          fname: 'ทดสอบ',
          lname: 'ระบบ',
          email: 'test@example.com',
          password: 'ก'.repeat(30),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await json('/register', {
          fname: 'ทดสอบ',
          lname: 'ระบบ',
          email: 'test@example.com',
          password: 'test-password',
        })
      ).status,
    ).toBe(201);
    const extra = await json('/register', {
      fname: 'ทดสอบ',
      lname: 'ระบบ',
      email: 'test@example.com',
      password: 'test-password',
      admin_role: 'owner',
    });
    const response = (await extra.json()) as Record<string, unknown>;
    expect(response['admin_role']).toBeUndefined();
  });
  it('allows an actual image and rejects disguised text', async () => {
    const jpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer();
    expect((await upload([jpeg])).status).toBe(201);
    expect((await upload([Buffer.from('not an image')])).status).toBe(400);
  });
  it('bounds one file and the combined batch during streaming', async () => {
    expect((await upload([Buffer.alloc(MAX_IMAGE_BYTES + 1)])).status).toBe(
      413,
    );
    const part = Buffer.alloc(Math.ceil(MAX_BATCH_BYTES / 4) + 1);
    expect((await upload([part, part, part, part])).status).toBe(413);
  });
  it('allows the configured origin but does not grant CORS access to other sites', async () => {
    const good = await fetch(base + '/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:4200',
        'Access-Control-Request-Method': 'POST',
      },
    });
    const bad = await fetch(base + '/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(good.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:4200',
    );
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('limits repeated login attempts even when a client spoofs a forwarded IP', async () => {
    let response: Response | undefined;
    for (let index = 0; index < 21; index++) {
      response = await fetch(base + '/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.0.0.${index}`,
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password',
        }),
      });
    }
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
