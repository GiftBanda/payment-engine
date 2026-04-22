import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import configuration, { isQueueDashboardEnabled, validateEnvironment } from './config';

// Entities
import { Payment } from './payments/entities/payment.entity';
import { TransactionLog } from './payments/entities/transaction-log.entity';
import { Plan } from './billing/entities/plan.entity';
import { Subscription } from './billing/entities/subscription.entity';
import { WebhookSubscription } from './webhooks/entities/webhook-subscription.entity';
import { WebhookDelivery } from './webhooks/entities/webhook-delivery.entity';
import { IdempotencyKey } from './idempotency/entities/idempotency-key.entity';

// Feature Modules
import { PaymentsModule } from './payments/payments.module';
import { BillingModule } from './billing/billing.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { ProvidersModule } from './providers/providers.module';

// Health + Auth
import { HealthController } from './health.controller';
import { ApiKeyGuard } from './common/guards/api-key.guard';
import { QUEUES } from './common/constants';
import { QueueDashboardModule } from './queue-dashboard/queue-dashboard.module';

const queueDashboardImports = isQueueDashboardEnabled(process.env)
  ? [QueueDashboardModule]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
      validate: validateEnvironment,
    }),

    // Rate limiting: 120 requests / 60s per IP globally
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 120 },
      { name: 'payments', ttl: 60_000, limit: 30 }, // stricter for payment creation
    ]),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbSslEnabled = config.get<boolean>('database.ssl', false);
        const sslRejectUnauthorized = config.get<boolean>('database.sslRejectUnauthorized', true);

        return {
          type: 'postgres',
          host: config.get('database.host'),
          port: config.get('database.port'),
          username: config.get('database.username'),
          password: config.get('database.password'),
          database: config.get('database.name'),
          entities: [
            Payment, TransactionLog, Plan, Subscription,
            WebhookSubscription, WebhookDelivery, IdempotencyKey,
          ],
          synchronize: !config.get<boolean>('isProduction', false),
          logging: config.get('nodeEnv') === 'development',
          ssl: dbSslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : false,
        };
      },
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
        },
        defaultJobOptions: {
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 500 },
        },
      }),
    }),

    BullModule.registerQueue({ name: QUEUES.PAYMENTS }),

    ScheduleModule.forRoot(),

    IdempotencyModule,
    ProvidersModule,
    PaymentsModule,
    BillingModule,
    WebhooksModule,
    ...queueDashboardImports,
  ],
  controllers: [HealthController],
  providers: [
    // Global rate-limit guard
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global API-key guard
    { provide: APP_GUARD, useClass: ApiKeyGuard },
  ],
})
export class AppModule {}
