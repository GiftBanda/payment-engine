import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { Payment } from '../payments/entities/payment.entity';
import { TransactionLog } from '../payments/entities/transaction-log.entity';
import { Plan } from '../billing/entities/plan.entity';
import { Subscription } from '../billing/entities/subscription.entity';
import { WebhookSubscription } from '../webhooks/entities/webhook-subscription.entity';
import { WebhookDelivery } from '../webhooks/entities/webhook-delivery.entity';
import { IdempotencyKey } from '../idempotency/entities/idempotency-key.entity';
import { isProductionEnv, validateDatabaseEnvironment } from '../config';

dotenv.config();

validateDatabaseEnvironment(process.env);

const databaseSslEnabled = (() => {
  const rawValue = process.env.DB_SSL?.trim().toLowerCase();
  if (!rawValue) {
    return isProductionEnv(process.env);
  }

  return ['1', 'true', 'yes', 'on'].includes(rawValue);
})();

const sslRejectUnauthorized = (() => {
  const rawValue = process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase();
  if (!rawValue) {
    return true;
  }

  return !['0', 'false', 'no', 'off'].includes(rawValue);
})();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'payment_engine',
  entities: [
    Payment,
    TransactionLog,
    Plan,
    Subscription,
    WebhookSubscription,
    WebhookDelivery,
    IdempotencyKey,
  ],
  migrations: ['src/database/migrations/*.ts'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  ssl: databaseSslEnabled ? { rejectUnauthorized: sslRejectUnauthorized } : false,
});
