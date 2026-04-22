import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1745000000000 implements MigrationInterface {
  name = 'InitialSchema1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── idempotency_keys ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "key"         VARCHAR(255)  NOT NULL,
        "status"      VARCHAR(20)   NOT NULL DEFAULT 'processing',
        "response"    JSONB,
        "requestPath" VARCHAR(100),
        "createdAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"   TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_idempotency_keys" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_idempotency_keys_createdAt" ON "idempotency_keys" ("createdAt")`);

    // ── plans ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "plans" (
        "id"            UUID          NOT NULL DEFAULT gen_random_uuid(),
        "name"          VARCHAR(100)  NOT NULL,
        "price"         BIGINT        NOT NULL,
        "currency"      VARCHAR(10)   NOT NULL,
        "interval"      VARCHAR(20)   NOT NULL DEFAULT 'month',
        "intervalCount" INTEGER       NOT NULL DEFAULT 1,
        "features"      JSONB,
        "isActive"      BOOLEAN       NOT NULL DEFAULT true,
        "createdAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt"     TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_plans"          PRIMARY KEY ("id"),
        CONSTRAINT "UQ_plans_name"     UNIQUE ("name")
      )
    `);

    // ── subscriptions ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "subscription_status_enum" AS ENUM ('active', 'past_due', 'cancelled', 'trialing')
    `);
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id"                  UUID                        NOT NULL DEFAULT gen_random_uuid(),
        "tenantId"            VARCHAR(100)                NOT NULL,
        "planId"              UUID                        NOT NULL,
        "status"              "subscription_status_enum"  NOT NULL DEFAULT 'active',
        "paymentProvider"     VARCHAR(50)                 NOT NULL,
        "paymentMetadata"     JSONB,
        "currentPeriodStart"  TIMESTAMP                   NOT NULL,
        "currentPeriodEnd"    TIMESTAMP                   NOT NULL,
        "failedPaymentCount"  INTEGER                     NOT NULL DEFAULT 0,
        "cancelledAt"         TIMESTAMP,
        "cancellationReason"  TEXT,
        "createdAt"           TIMESTAMP                   NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP                   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscriptions_plan" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_tenantId"        ON "subscriptions" ("tenantId")`);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_currentPeriodEnd" ON "subscriptions" ("currentPeriodEnd")`);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_status"           ON "subscriptions" ("status")`);

    // ── payments ─────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "payment_status_enum" AS ENUM ('pending','processing','success','failed','refunded','cancelled')
    `);
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"               UUID                    NOT NULL DEFAULT gen_random_uuid(),
        "idempotencyKey"   VARCHAR(255)             NOT NULL,
        "tenantId"         VARCHAR(100)             NOT NULL,
        "amount"           BIGINT                   NOT NULL,
        "currency"         VARCHAR(10)              NOT NULL,
        "status"           "payment_status_enum"    NOT NULL DEFAULT 'pending',
        "provider"         VARCHAR(50)              NOT NULL,
        "externalId"       VARCHAR(255),
        "retryCount"       INTEGER                  NOT NULL DEFAULT 0,
        "maxRetries"       INTEGER                  NOT NULL DEFAULT 3,
        "metadata"         JSONB,
        "providerResponse" JSONB,
        "failureReason"    TEXT,
        "subscriptionId"   UUID,
        "createdAt"        TIMESTAMP                NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMP                NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_subscription"
          FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_idempotencyKey" ON "payments" ("idempotencyKey")`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_tenantId"       ON "payments" ("tenantId")`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_createdAt"      ON "payments" ("createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_status"         ON "payments" ("status")`);

    // ── transaction_logs ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "transaction_logs" (
        "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
        "paymentId"     UUID         NOT NULL,
        "tenantId"      VARCHAR(100) NOT NULL,
        "event"         VARCHAR(50)  NOT NULL,
        "previousState" JSONB,
        "newState"      JSONB,
        "metadata"      JSONB,
        "createdAt"     TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transaction_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_transaction_logs_paymentId" ON "transaction_logs" ("paymentId")`);
    await queryRunner.query(`CREATE INDEX "IDX_transaction_logs_tenantId"  ON "transaction_logs" ("tenantId")`);
    await queryRunner.query(`CREATE INDEX "IDX_transaction_logs_createdAt" ON "transaction_logs" ("createdAt")`);

    // ── webhook_subscriptions ────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE "webhook_subscriptions" (
        "id"        UUID          NOT NULL DEFAULT gen_random_uuid(),
        "tenantId"  VARCHAR(100)  NOT NULL,
        "url"       VARCHAR(500)  NOT NULL,
        "events"    TEXT          NOT NULL,
        "secret"    VARCHAR(255)  NOT NULL,
        "isActive"  BOOLEAN       NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP     NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_subscriptions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_webhook_subscriptions_tenantId" ON "webhook_subscriptions" ("tenantId")`);

    // ── webhook_deliveries ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TYPE "webhook_delivery_status_enum" AS ENUM ('pending', 'delivered', 'failed')
    `);
    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id"                    UUID                            NOT NULL DEFAULT gen_random_uuid(),
        "webhookSubscriptionId" UUID                            NOT NULL,
        "resourceId"            UUID                            NOT NULL,
        "event"                 VARCHAR(100)                    NOT NULL,
        "payload"               JSONB                           NOT NULL,
        "status"                "webhook_delivery_status_enum"  NOT NULL DEFAULT 'pending',
        "attempts"              INTEGER                         NOT NULL DEFAULT 0,
        "lastHttpStatus"        INTEGER,
        "lastError"             TEXT,
        "deliveredAt"           TIMESTAMP,
        "createdAt"             TIMESTAMP                       NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_webhook_deliveries_subscriptionId" ON "webhook_deliveries" ("webhookSubscriptionId")`);
    await queryRunner.query(`CREATE INDEX "IDX_webhook_deliveries_resourceId"     ON "webhook_deliveries" ("resourceId")`);
    await queryRunner.query(`CREATE INDEX "IDX_webhook_deliveries_createdAt"      ON "webhook_deliveries" ("createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
    await queryRunner.query(`DROP TYPE "webhook_delivery_status_enum"`);
    await queryRunner.query(`DROP TABLE "webhook_subscriptions"`);
    await queryRunner.query(`DROP TABLE "transaction_logs"`);
    await queryRunner.query(`DROP TABLE "payments"`);
    await queryRunner.query(`DROP TYPE "payment_status_enum"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TYPE "subscription_status_enum"`);
    await queryRunner.query(`DROP TABLE "plans"`);
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
  }
}
