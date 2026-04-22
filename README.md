# Payment & Billing Engine

A production-grade payment orchestration service built with **NestJS**, **PostgreSQL**, **BullMQ**, and **Redis**. Supports Lenco and Stripe (mock), subscription billing, idempotent payment processing, HMAC-signed webhook delivery, and full audit logging.

## 🚀 Deployment

### Railway (Recommended for Africa)

Deploy to **Railway** with one click—no Stripe dependency, works in Zambia and across Africa.

👉 **[Railway Deployment Guide](./DEPLOY_RAILWAY.md)**

### Docker Compose (Local Development)

```bash
# 1. Start infrastructure
docker-compose up postgres redis -d

# 2. Configure
cp .env.example .env   # fill in your Lenco + Stripe keys

# 3. Run
npm install && npm run start:dev

# App:     http://localhost:3000
# Swagger: http://localhost:3000/docs

# 4. Tests
npm test
```

## API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/payments` | Initiate payment (idempotent) |
| GET | `/payments` | List with filters |
| GET | `/payments/:id` | Get payment |
| POST | `/payments/:id/refund` | Full or partial refund |
| POST | `/payments/:id/sync` | Poll provider for status |
| GET | `/payments/:id/logs` | Audit log |
| POST | `/billing/plans` | Create plan |
| GET | `/billing/plans` | List plans |
| POST | `/billing/subscriptions` | Subscribe tenant |
| POST | `/billing/subscriptions/:id/cancel` | Cancel subscription |
| POST | `/webhooks/subscriptions` | Register endpoint |
| GET | `/webhooks/deliveries` | Delivery history |
| POST | `/webhooks/inbound/lenco` | Receive Lenco events |
| POST | `/webhooks/inbound/stripe` | Receive Stripe events |

## Key Patterns

**Idempotency** — same key replays cached result, 409 on in-flight, retry allowed on failure

**Retry backoff** — BullMQ: immediate → +3s → +9s → +27s → mark FAILED

**Webhook signing** — HMAC-SHA256 per delivery, 5-attempt retry queue

**Subscription renewal** — hourly cron, auto-cancel after 3 failed payments

## Structure

```
src/
├── common/constants.ts        All enums + queue/job names
├── config.ts                  Env config
├── idempotency/               IdempotencyKey entity + service
├── providers/                 IPaymentProvider, Lenco, Stripe, Factory
├── payments/                  Entity, service, BullMQ processor, controller
├── billing/                   Plan + Subscription, renewal cron
├── webhooks/                  HMAC delivery, inbound Lenco/Stripe handlers
└── app.module.ts              TypeORM + BullMQ + Schedule wired up

test/unit/
├── idempotency.service.spec.ts
├── payments.service.spec.ts
├── webhooks.service.spec.ts
└── provider.factory.spec.ts
```
