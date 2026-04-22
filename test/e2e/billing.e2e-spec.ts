import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, NotFoundException } from '@nestjs/common';
import request = require('supertest');
import { BillingController } from '../../src/billing/billing.controller';
import { BillingService } from '../../src/billing/billing.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { SUBSCRIPTION_STATUS } from '../../src/common/constants';

const mockPlan = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  name: 'pro',
  price: 4990,
  currency: 'USD',
  interval: 'month',
  intervalCount: 1,
  features: ['25 users', 'API access'],
  isActive: true,
};

const mockSubscription = {
  id: '550e8400-e29b-41d4-a716-446655440002',
  tenantId: 'tenant_acme',
  planId: mockPlan.id,
  plan: mockPlan,
  status: SUBSCRIPTION_STATUS.ACTIVE,
  paymentProvider: 'lenco',
  currentPeriodStart: new Date('2025-04-01'),
  currentPeriodEnd: new Date('2025-05-01'),
  failedPaymentCount: 0,
  createdAt: new Date('2025-04-01'),
};

const mockBillingService = {
  createPlan: jest.fn().mockResolvedValue(mockPlan),
  listPlans: jest.fn().mockResolvedValue([mockPlan]),
  findPlan: jest.fn().mockResolvedValue(mockPlan),
  createSubscription: jest.fn().mockResolvedValue(mockSubscription),
  findSubscription: jest.fn().mockResolvedValue(mockSubscription),
  listByTenant: jest.fn().mockResolvedValue([mockSubscription]),
  cancelSubscription: jest.fn().mockResolvedValue({
    ...mockSubscription,
    status: SUBSCRIPTION_STATUS.CANCELLED,
    cancelledAt: new Date(),
  }),
};

describe('Billing (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: mockBillingService }],
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

  // ── Plans ────────────────────────────────────────────────────────────────────

  describe('POST /billing/plans', () => {
    it('201 — creates a plan', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/plans')
        .send({ name: 'pro', price: 4990, currency: 'USD' })
        .expect(201);

      expect(res.body.name).toBe('pro');
      expect(res.body.price).toBe(4990);
    });

    it('400 — rejects missing price', async () => {
      await request(app.getHttpServer())
        .post('/billing/plans')
        .send({ name: 'pro', currency: 'USD' })
        .expect(400);
    });

    it('400 — rejects negative price', async () => {
      await request(app.getHttpServer())
        .post('/billing/plans')
        .send({ name: 'pro', price: -100, currency: 'USD' })
        .expect(400);
    });
  });

  describe('GET /billing/plans', () => {
    it('200 — returns list of active plans', async () => {
      const res = await request(app.getHttpServer())
        .get('/billing/plans')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].name).toBe('pro');
    });
  });

  describe('GET /billing/plans/:id', () => {
    it('200 — returns plan by UUID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/billing/plans/${mockPlan.id}`)
        .expect(200);

      expect(res.body.id).toBe(mockPlan.id);
    });

    it('404 — plan not found', async () => {
      mockBillingService.findPlan.mockRejectedValueOnce(
        new NotFoundException('Plan not found'),
      );
      const res = await request(app.getHttpServer())
        .get(`/billing/plans/${mockPlan.id}`)
        .expect(404);

      expect(res.body.message).toBe('Plan not found');
    });
  });

  // ── Subscriptions ────────────────────────────────────────────────────────────

  describe('POST /billing/subscriptions', () => {
    const validPayload = {
      tenantId: 'tenant_acme',
      planId: mockPlan.id,
      paymentProvider: 'lenco',
      paymentMetadata: { accountNumber: '1234567890' },
    };

    it('201 — creates subscription and triggers initial charge', async () => {
      const res = await request(app.getHttpServer())
        .post('/billing/subscriptions')
        .send(validPayload)
        .expect(201);

      expect(res.body.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(res.body.tenantId).toBe('tenant_acme');
      expect(mockBillingService.createSubscription).toHaveBeenCalledWith(validPayload);
    });

    it('400 — rejects missing tenantId', async () => {
      await request(app.getHttpServer())
        .post('/billing/subscriptions')
        .send({ planId: mockPlan.id, paymentProvider: 'lenco' })
        .expect(400);
    });
  });

  describe('GET /billing/subscriptions', () => {
    it('200 — returns subscriptions for tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/billing/subscriptions?tenantId=tenant_acme')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].tenantId).toBe('tenant_acme');
    });
  });

  describe('GET /billing/subscriptions/:id', () => {
    it('200 — returns subscription with embedded plan', async () => {
      const res = await request(app.getHttpServer())
        .get(`/billing/subscriptions/${mockSubscription.id}`)
        .expect(200);

      expect(res.body.plan.name).toBe('pro');
    });
  });

  describe('POST /billing/subscriptions/:id/cancel', () => {
    it('200 — cancel at period end (default)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/billing/subscriptions/${mockSubscription.id}/cancel`)
        .send({ reason: 'Too expensive' })
        .expect(200);

      expect(res.body.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
      expect(mockBillingService.cancelSubscription).toHaveBeenCalledWith(
        mockSubscription.id,
        expect.objectContaining({ reason: 'Too expensive' }),
      );
    });

    it('200 — immediate cancel', async () => {
      await request(app.getHttpServer())
        .post(`/billing/subscriptions/${mockSubscription.id}/cancel`)
        .send({ cancelAtPeriodEnd: false })
        .expect(200);

      expect(mockBillingService.cancelSubscription).toHaveBeenCalledWith(
        mockSubscription.id,
        expect.objectContaining({ cancelAtPeriodEnd: false }),
      );
    });
  });
});
