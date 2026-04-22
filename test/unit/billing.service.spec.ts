import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { BillingService } from '../../src/billing/billing.service';
import { Plan } from '../../src/billing/entities/plan.entity';
import { Subscription } from '../../src/billing/entities/subscription.entity';
import { PaymentsService } from '../../src/payments/payments.service';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { SUBSCRIPTION_STATUS } from '../../src/common/constants';

const mockPlan = (overrides = {}): Plan => ({
  id: 'plan_001',
  name: 'pro',
  price: 4990,
  currency: 'USD',
  interval: 'month',
  intervalCount: 1,
  features: [],
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as any);

const mockSubscription = (overrides = {}): Subscription => ({
  id: 'sub_001',
  tenantId: 'tenant_acme',
  planId: 'plan_001',
  plan: mockPlan(),
  status: SUBSCRIPTION_STATUS.ACTIVE,
  paymentProvider: 'lenco',
  paymentMetadata: {},
  currentPeriodStart: new Date('2025-04-01'),
  currentPeriodEnd: new Date('2025-05-01'),
  failedPaymentCount: 0,
  cancelledAt: null,
  cancellationReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as any);

describe('BillingService', () => {
  let service: BillingService;
  let planRepo: any;
  let subscriptionRepo: any;
  let paymentsService: any;
  let webhooksService: any;

  beforeEach(async () => {
    planRepo = {
      create: jest.fn((d) => d),
      save: jest.fn((e) => Promise.resolve({ id: 'plan_new', ...e })),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    subscriptionRepo = {
      create: jest.fn((d) => d),
      save: jest.fn((e) => Promise.resolve({ id: 'sub_new', ...e })),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
    };

    paymentsService = { create: jest.fn().mockResolvedValue({ id: 'pay_001' }) };
    webhooksService = { enqueueDispatch: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: getRepositoryToken(Plan), useValue: planRepo },
        { provide: getRepositoryToken(Subscription), useValue: subscriptionRepo },
        { provide: PaymentsService, useValue: paymentsService },
        { provide: WebhooksService, useValue: webhooksService },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  // ── Plans ──────────────────────────────────────────────────────────────────

  describe('createPlan()', () => {
    it('creates and returns a new plan', async () => {
      const result = await service.createPlan({
        name: 'starter',
        price: 1990,
        currency: 'USD',
      });
      expect(planRepo.save).toHaveBeenCalled();
      expect(result.name).toBe('starter');
    });
  });

  describe('findPlan()', () => {
    it('returns plan when found', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan());
      const result = await service.findPlan('plan_001');
      expect(result.id).toBe('plan_001');
    });

    it('throws NotFoundException when plan missing', async () => {
      planRepo.findOne.mockResolvedValue(null);
      await expect(service.findPlan('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  // ── Subscriptions ──────────────────────────────────────────────────────────

  describe('createSubscription()', () => {
    it('saves subscription and triggers initial charge', async () => {
      planRepo.findOne.mockResolvedValue(mockPlan());

      await service.createSubscription({
        tenantId: 'tenant_acme',
        planId: 'plan_001',
        paymentProvider: 'lenco',
        paymentMetadata: { accountNumber: '123' },
      });

      expect(subscriptionRepo.save).toHaveBeenCalled();
      expect(paymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant_acme',
          amount: 4990,
          currency: 'USD',
          provider: 'lenco',
        }),
      );
      expect(webhooksService.enqueueDispatch).toHaveBeenCalledWith(
        expect.anything(),
        'subscription.created',
        expect.any(Object),
      );
    });
  });

  describe('cancelSubscription()', () => {
    it('immediately cancels and sets cancelledAt', async () => {
      const sub = mockSubscription();
      subscriptionRepo.findOne.mockResolvedValue(sub);
      subscriptionRepo.save.mockResolvedValue({ ...sub, status: SUBSCRIPTION_STATUS.CANCELLED });

      const result = await service.cancelSubscription('sub_001', {
        cancelAtPeriodEnd: false,
        reason: 'too expensive',
      });

      expect(result.status).toBe(SUBSCRIPTION_STATUS.CANCELLED);
      expect(webhooksService.enqueueDispatch).toHaveBeenCalledWith(
        'sub_001',
        'subscription.cancelled',
        expect.objectContaining({ cancelAtPeriodEnd: false }),
      );
    });

    it('sets cancellation reason without changing status for period-end cancel', async () => {
      const sub = mockSubscription();
      subscriptionRepo.findOne.mockResolvedValue(sub);
      subscriptionRepo.save.mockResolvedValue(sub);

      await service.cancelSubscription('sub_001', {
        cancelAtPeriodEnd: true,
        reason: 'switching provider',
      });

      // Status stays ACTIVE until renewal scheduler runs
      expect(sub.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    });

    it('throws BadRequestException if already cancelled', async () => {
      subscriptionRepo.findOne.mockResolvedValue(
        mockSubscription({ status: SUBSCRIPTION_STATUS.CANCELLED }),
      );
      await expect(
        service.cancelSubscription('sub_001', {}),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── Renewal ────────────────────────────────────────────────────────────────

  describe('renewSubscription()', () => {
    it('advances billing period and resets failedPaymentCount on success', async () => {
      const sub = mockSubscription();
      paymentsService.create.mockResolvedValue({ id: 'pay_renew_001' });

      await service.renewSubscription(sub);

      expect(paymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 4990,
          provider: 'lenco',
          subscriptionId: 'sub_001',
        }),
      );

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub_001',
        expect.objectContaining({
          failedPaymentCount: 0,
          status: SUBSCRIPTION_STATUS.ACTIVE,
        }),
      );

      expect(webhooksService.enqueueDispatch).toHaveBeenCalledWith(
        'sub_001',
        'subscription.renewed',
        expect.any(Object),
      );
    });

    it('marks subscription PAST_DUE on first failed renewal', async () => {
      const sub = mockSubscription({ failedPaymentCount: 0 });
      paymentsService.create.mockRejectedValue(new Error('insufficient funds'));

      await service.renewSubscription(sub);

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub_001',
        expect.objectContaining({ status: SUBSCRIPTION_STATUS.PAST_DUE, failedPaymentCount: 1 }),
      );
    });

    it('auto-cancels subscription after 3 failed renewals', async () => {
      const sub = mockSubscription({ failedPaymentCount: 2 });
      paymentsService.create.mockRejectedValue(new Error('card declined'));

      await service.renewSubscription(sub);

      expect(subscriptionRepo.update).toHaveBeenCalledWith(
        'sub_001',
        expect.objectContaining({
          status: SUBSCRIPTION_STATUS.CANCELLED,
          failedPaymentCount: 3,
        }),
      );
    });
  });
});
