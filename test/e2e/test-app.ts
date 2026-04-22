import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { Payment } from '../../src/payments/entities/payment.entity';
import { TransactionLog } from '../../src/payments/entities/transaction-log.entity';
import { Plan } from '../../src/billing/entities/plan.entity';
import { Subscription } from '../../src/billing/entities/subscription.entity';
import { WebhookSubscription } from '../../src/webhooks/entities/webhook-subscription.entity';
import { WebhookDelivery } from '../../src/webhooks/entities/webhook-delivery.entity';
import { IdempotencyKey } from '../../src/idempotency/entities/idempotency-key.entity';

import { PaymentsModule } from '../../src/payments/payments.module';
import { BillingModule } from '../../src/billing/billing.module';
import { WebhooksModule } from '../../src/webhooks/webhooks.module';
import { IdempotencyModule } from '../../src/idempotency/idempotency.module';
import { ProvidersModule } from '../../src/providers/providers.module';
import { HealthController } from '../../src/health.controller';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { QUEUES } from '../../src/common/constants';

// Mock BullMQ queue — avoids real Redis in tests
const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  getJobCounts: jest.fn().mockResolvedValue({ active: 0, waiting: 0, completed: 0, failed: 0 }),
};

jest.mock('@nestjs/bullmq', () => {
  const original = jest.requireActual('@nestjs/bullmq');
  return {
    ...original,
    InjectQueue: () => (target: any, key: string) => {
      Object.defineProperty(target, key, { get: () => mockQueue });
    },
    getQueueToken: original.getQueueToken,
  };
});

export async function buildTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      ScheduleModule.forRoot(),

      // In-memory SQLite — no Docker needed for e2e
      TypeOrmModule.forRoot({
        type: 'sqlite',
        database: ':memory:',
        entities: [
          Payment, TransactionLog, Plan, Subscription,
          WebhookSubscription, WebhookDelivery, IdempotencyKey,
        ],
        synchronize: true,
        logging: false,
      }),

      // Mock BullMQ — no real Redis needed
      BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
      BullModule.registerQueue({ name: QUEUES.PAYMENTS }),
      BullModule.registerQueue({ name: QUEUES.WEBHOOKS }),
      BullModule.registerQueue({ name: QUEUES.BILLING }),

      IdempotencyModule,
      ProvidersModule,
      PaymentsModule,
      BillingModule,
      WebhooksModule,
    ],
    controllers: [HealthController],
  })
    .overrideProvider(`BullQueue_${QUEUES.PAYMENTS}`)
    .useValue(mockQueue)
    .overrideProvider(`BullQueue_${QUEUES.WEBHOOKS}`)
    .useValue(mockQueue)
    .overrideProvider(`BullQueue_${QUEUES.BILLING}`)
    .useValue(mockQueue)
    .compile();

  const app = moduleFixture.createNestApplication();

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();
  return app;
}

export { mockQueue };
