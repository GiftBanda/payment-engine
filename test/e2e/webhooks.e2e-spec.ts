import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import * as crypto from 'crypto';
import { WebhooksController } from '../../src/webhooks/webhooks.controller';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { WEBHOOK_STATUS } from '../../src/common/constants';

const mockWebhookSub = {
  id: '550e8400-e29b-41d4-a716-446655440003',
  tenantId: 'tenant_acme',
  url: 'https://acme.com/webhooks',
  events: ['payment.success', 'payment.failed'],
  secret: 'a'.repeat(64),
  isActive: true,
};

const mockDelivery = {
  id: 'wd-uuid-0001',
  webhookSubscriptionId: mockWebhookSub.id,
  resourceId: 'pay-uuid-0001',
  event: 'payment.success',
  payload: { amount: 49900 },
  status: WEBHOOK_STATUS.DELIVERED,
  attempts: 1,
  lastHttpStatus: 200,
  createdAt: new Date(),
};

const SIGNING_SECRET = 'test-signing-secret-exactly-32chars!';

const mockWebhooksService = {
  register: jest.fn().mockResolvedValue(mockWebhookSub),
  listByTenant: jest.fn().mockResolvedValue([mockWebhookSub]),
  deactivate: jest.fn().mockResolvedValue(undefined),
  getDeliveries: jest.fn().mockResolvedValue([mockDelivery]),
  enqueueDispatch: jest.fn().mockResolvedValue(undefined),
  verify: jest.fn().mockImplementation(
    (payload: string, signature: string, secret?: string) => {
      const expected = crypto
        .createHmac('sha256', secret ?? SIGNING_SECRET)
        .update(payload)
        .digest('hex');
      try {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    },
  ),
};

describe('Webhooks (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: WebhooksService, useValue: mockWebhooksService }],
    }).compile();

    app = module.createNestApplication();
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
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => jest.clearAllMocks());

  // ── Registration ─────────────────────────────────────────────────────────────

  describe('POST /webhooks/subscriptions', () => {
    it('201 — registers a webhook subscription', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/subscriptions')
        .send({
          tenantId: 'tenant_acme',
          url: 'https://acme.com/webhooks',
          events: ['payment.success', 'payment.failed'],
        })
        .expect(201);

      expect(res.body.tenantId).toBe('tenant_acme');
      expect(res.body.isActive).toBe(true);
    });
  });

  describe('GET /webhooks/subscriptions', () => {
    it('200 — returns subscriptions for tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/webhooks/subscriptions?tenantId=tenant_acme')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].url).toBe('https://acme.com/webhooks');
    });
  });

  describe('DELETE /webhooks/subscriptions/:id', () => {
    it('204 — deactivates subscription', async () => {
      await request(app.getHttpServer())
        .delete(`/webhooks/subscriptions/${mockWebhookSub.id}`)
        .expect(204);

      expect(mockWebhooksService.deactivate).toHaveBeenCalledWith(mockWebhookSub.id);
    });
  });

  describe('GET /webhooks/deliveries', () => {
    it('200 — returns delivery history for a resource', async () => {
      const res = await request(app.getHttpServer())
        .get('/webhooks/deliveries?resourceId=pay-uuid-0001')
        .expect(200);

      expect(res.body[0].status).toBe(WEBHOOK_STATUS.DELIVERED);
      expect(res.body[0].event).toBe('payment.success');
    });
  });

  // ── Inbound webhooks ──────────────────────────────────────────────────────────

  describe('POST /webhooks/inbound/lenco', () => {
    it('200 — accepts valid Lenco webhook with correct HMAC signature', async () => {
      const body = {
        event: 'transfer.successful',
        data: { reference: 'lenco_ref_001', amount: 499 },
      };
      const bodyStr = JSON.stringify(body);
      const signature = crypto
        .createHmac('sha256', SIGNING_SECRET)
        .update(bodyStr)
        .digest('hex');

      // Override verify to return true for this test
      mockWebhooksService.verify.mockReturnValueOnce(true);

      const res = await request(app.getHttpServer())
        .post('/webhooks/inbound/lenco')
        .set('x-lenco-signature', signature)
        .send(body)
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(mockWebhooksService.enqueueDispatch).toHaveBeenCalledWith(
        'lenco_ref_001',
        'payment.success',
        body.data,
      );
    });

    it('400 — rejects Lenco webhook with invalid signature', async () => {
      mockWebhooksService.verify.mockReturnValueOnce(false);

      await request(app.getHttpServer())
        .post('/webhooks/inbound/lenco')
        .set('x-lenco-signature', 'invalid-signature')
        .send({ event: 'transfer.successful', data: {} })
        .expect(400);
    });

    it('200 — ignores unmapped Lenco events gracefully', async () => {
      mockWebhooksService.verify.mockReturnValueOnce(true);

      const res = await request(app.getHttpServer())
        .post('/webhooks/inbound/lenco')
        .set('x-lenco-signature', 'any')
        .send({ event: 'unknown.event', data: {} })
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(mockWebhooksService.enqueueDispatch).not.toHaveBeenCalled();
    });
  });

  describe('POST /webhooks/inbound/stripe', () => {
    it('200 — accepts Stripe payment_intent.succeeded event', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/inbound/stripe')
        .set('stripe-signature', 'mock_sig')
        .send({
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_mock_001', amount: 49900 } },
        })
        .expect(200);

      expect(res.body.received).toBe(true);
      expect(mockWebhooksService.enqueueDispatch).toHaveBeenCalledWith(
        'pi_mock_001',
        'payment.success',
        expect.objectContaining({ id: 'pi_mock_001' }),
      );
    });

    it('200 — accepts Stripe charge.refunded event', async () => {
      await request(app.getHttpServer())
        .post('/webhooks/inbound/stripe')
        .send({
          type: 'charge.refunded',
          data: { object: { id: 'ch_mock_001' } },
        })
        .expect(200);

      expect(mockWebhooksService.enqueueDispatch).toHaveBeenCalledWith(
        'ch_mock_001',
        'payment.refunded',
        expect.any(Object),
      );
    });
  });
});
