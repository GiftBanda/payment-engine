import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from './common/constants';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(QUEUES.PAYMENTS) private readonly paymentsQueue: Queue,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check — DB + Redis + queue stats' })
  async check() {
    const dbOk = this.dataSource.isInitialized;

    let redisOk = false;
    let queueCounts = {};
    try {
      queueCounts = await this.paymentsQueue.getJobCounts(
        'active', 'waiting', 'completed', 'failed', 'delayed',
      );
      redisOk = true;
    } catch {
      redisOk = false;
    }

    const status = dbOk && redisOk ? 'ok' : 'degraded';

    return {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
      },
      queues: {
        payments: queueCounts,
      },
    };
  }
}
