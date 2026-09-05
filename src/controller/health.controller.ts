import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly database: DataSource) {}

  @Get()
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    let database = false;
    let vision = false;
    await Promise.all([
      this.checkDatabase()
        .then(() => {
          database = true;
        })
        .catch(() => undefined),
      fetch(
        `${process.env.VISION_SERVICE_URL ?? 'http://127.0.0.1:8000'}/health`,
        {
          signal: AbortSignal.timeout(3000),
        },
      )
        .then((response) => {
          vision = response.ok;
        })
        .catch(() => undefined),
    ]);
    const result = {
      status: database && vision ? 'ok' : 'degraded',
      database,
      vision,
    };
    if (!database || !vision) throw new ServiceUnavailableException(result);
    return result;
  }

  private async checkDatabase(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.database.query('SELECT 1'),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), 3000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
