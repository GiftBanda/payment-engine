import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, NotFoundException, BadRequestException } from '@nestjs/common';
import request = require('supertest');
import { PaymentsController } from '../../src/payments/payments.controller';
import { PaymentsService } from '../../src/payments/payments.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PAYMENT_STATUS } from '../../src/common/constants';

// ── Mock PaymentsService ──────────────────────────────────────────────────────
const mockPayment = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  tenantId: 'tenant_acme',
  amount: 49900,
  currency: 'ZMW',
  provider: 'lenco',
  idempotencyKey: 'idem_test_001',
  status: PAYMENT_STATUS.PENDING,
  retryCount: 0,
  metadata: { accountNumber: '1234567890' },
  createdAt: new Date('2025-04-22T10:00:00Z'),
  updatedAt: new Date('2025-04-22T10:00:00Z'),
};

const mockPaymentsService = {
  create: jest.fn().mockResolvedValue(mockPayment),
  findOne: jest.fn().mockResolvedValue(mockPayment),
  findAll: jest.fn().mockResolvedValue({ data: [mockPayment], total: 1 }),
  refund: jest.fn().mockResolvedValue({ ...mockPayment, status: PAYMENT_STATUS.REFUNDED }),
  syncStatus: jest.fn().mockResolvedValue({ ...mockPayment, status: PAYMENT_STATUS.SUCCESS }),
  getLogs: jest.fn().mockResolvedValue([
    { id: 'log_001', paymentId: mockPayment.id, event: 'payment.created', createdAt: new Date() },
  ]),
};

// ─────────────────────────────────────────────────────────────────────────────

describe('Payments (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: mockPaymentsService }],
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

  // ── POST /payments ──────────────────────────────────────────────────────────

  describe('POST /payments', () => {
    const validPayload = {
      tenantId: 'tenant_acme',
      amount: 49900,
      currency: 'ZMW',
      provider: 'lenco',
      idempotencyKey: 'idem_test_001',
      metadata: { accountNumber: '1234567890' },
    };

    it('201 — creates payment with valid payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments')
        .send(validPayload)
        .expect(201);

      expect(res.body.id).toBe(mockPayment.id);
      expect(res.body.status).toBe(PAYMENT_STATUS.PENDING);
      expect(mockPaymentsService.create).toHaveBeenCalledWith(validPayload);
    });

    it('400 — rejects missing required fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/payments')
        .send({ tenantId: 'tenant_acme' }) // missing amount, currency, provider, idempotencyKey
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(mockPaymentsService.create).not.toHaveBeenCalled();
    });

    it('400 — rejects negative amount', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ ...validPayload, amount: -100 })
        .expect(400);
    });

    it('400 — rejects unknown extra fields (whitelist)', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ ...validPayload, hackerField: 'injection' })
        .expect(400);
    });
  });

  // ── GET /payments ───────────────────────────────────────────────────────────

  describe('GET /payments', () => {
    it('200 — returns paginated payment list', async () => {
      const res = await request(app.getHttpServer())
        .get('/payments')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('200 — passes filter params to service', async () => {
      await request(app.getHttpServer())
        .get('/payments?tenantId=tenant_acme&status=pending&page=2&limit=10')
        .expect(200);

      expect(mockPaymentsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_acme',
          status: 'pending',
          page: 2,
          limit: 10,
        }),
      );
    });
  });

  // ── GET /payments/:id ────────────────────────────────────────────────────────

  describe('GET /payments/:id', () => {
    it('200 — returns payment by valid UUID', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${mockPayment.id}`)
        .expect(200);

      expect(res.body.id).toBe(mockPayment.id);
    });

    it('400 — rejects non-UUID id', async () => {
      await request(app.getHttpServer())
        .get('/payments/not-a-uuid')
        .expect(400);
    });

    it('404 — service throws NotFoundException', async () => {
      mockPaymentsService.findOne.mockRejectedValueOnce(
        new NotFoundException('Payment not found'),
      );

      const res = await request(app.getHttpServer())
        .get(`/payments/${mockPayment.id}`)
        .expect(404);

      expect(res.body.message).toBe('Payment not found');
    });
  });

  // ── POST /payments/:id/refund ────────────────────────────────────────────────

  describe('POST /payments/:id/refund', () => {
    it('200 — full refund (no amount)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${mockPayment.id}/refund`)
        .send({})
        .expect(200);

      expect(res.body.status).toBe(PAYMENT_STATUS.REFUNDED);
    });

    it('200 — partial refund with valid amount', async () => {
      await request(app.getHttpServer())
        .post(`/payments/${mockPayment.id}/refund`)
        .send({ amount: 10000, reason: 'Partial return' })
        .expect(200);

      expect(mockPaymentsService.refund).toHaveBeenCalledWith(
        mockPayment.id,
        { amount: 10000, reason: 'Partial return' },
      );
    });

    it('400 — BadRequestException from service (payment not successful)', async () => {
      mockPaymentsService.refund.mockRejectedValueOnce(
        new BadRequestException('Cannot refund a payment with status "pending"'),
      );

      const res = await request(app.getHttpServer())
        .post(`/payments/${mockPayment.id}/refund`)
        .send({})
        .expect(400);

      expect(res.body.message).toContain('Cannot refund');
    });
  });

  // ── POST /payments/:id/sync ──────────────────────────────────────────────────

  describe('POST /payments/:id/sync', () => {
    it('200 — syncs status from provider', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${mockPayment.id}/sync`)
        .expect(200);

      expect(res.body.status).toBe(PAYMENT_STATUS.SUCCESS);
    });
  });

  // ── GET /payments/:id/logs ───────────────────────────────────────────────────

  describe('GET /payments/:id/logs', () => {
    it('200 — returns transaction audit logs', async () => {
      const res = await request(app.getHttpServer())
        .get(`/payments/${mockPayment.id}/logs`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].event).toBe('payment.created');
    });
  });
});
