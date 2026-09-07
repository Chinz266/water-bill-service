import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { join } from 'node:path';

/** Shared by the real server and integration tests. */
export function configureApp(app: NestExpressApplication): void {
  const production = process.env.NODE_ENV === 'production';
  const origins = (
    process.env.CORS_ORIGINS ?? 'http://localhost:4200,http://127.0.0.1:4200'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (production && !process.env.CORS_ORIGINS)
    throw new Error('Production requires CORS_ORIGINS');
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
      throw new Error('Invalid CORS_ORIGINS');
    if (production && url.protocol !== 'https:')
      throw new Error('Production CORS origins must use HTTPS');
  }
  const server = app.getHttpAdapter().getInstance();
  server.disable('x-powered-by');
  if (process.env.TRUST_PROXY) {
    // Explicit addresses/CIDRs only; do not trust all clients or a variable hop count.
    const proxies = process.env.TRUST_PROXY.split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      proxies.some((value) =>
        ['true', '*', '0.0.0.0/0', '::/0'].includes(value),
      )
    )
      throw new Error('TRUST_PROXY must identify your proxy');
    server.set('trust proxy', proxies);
  }
  app.enableCors({ origin: origins });
  app.useGlobalPipes(
    new ValidationPipe({
      // Unknown fields are silently removed so old clients keep working while
      // services never receive undeclared values that could be mass-assigned.
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: false,
    }),
  );
  // The scan payload may contain a 3 MB data URL. Keep a finite JSON limit.
  app.useBodyParser('json', { limit: '4mb' });
  app.useBodyParser('urlencoded', { limit: '4mb', extended: false });
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    index: false,
  });
  if (
    process.env.SWAGGER_ENABLED === 'true' ||
    (!production && process.env.SWAGGER_ENABLED !== 'false')
  ) {
    const config = new DocumentBuilder()
      .setTitle('Water Bill API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, config));
  }
}
