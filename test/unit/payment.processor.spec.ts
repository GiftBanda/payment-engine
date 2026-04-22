import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PaymentProcessor } from '../../src/payments/payment.processor';
import { Payment } from '../../src/payments/entities/payment.entity';
import { ProviderFactory } from '../../src/providers/provider.factory';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { PAYMENT_STATUS } from '../../src/common/constants';

const mockPayment = (overrides = {}): Payment => ({
  id: 'pay_proc_001',
  tenantId: 'tenant_acme',
  amount: 49900,
  currency: 'ZMW',
  provider: 'lenco',
  idempotencyKey: 'idem_proc_001',
  status: PAYMENT_STATUS.PENDING,
  retryCount: 0,
  maxRetries: 3,
  externalId: null,
  metadata: {},
  providerResponse: null,
  failureReason: null,
  subscriptionId: null,
  subscription: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
} as any);

const makeJob = (data: any, overrides = {}) => ({
  name: 'process_charge',
  data,
  attemptsMade: 0,
  opts: { attempts: 4 },
  timestamp: Date.now(),
  processedOn: Date.now() + 100,
  id: 'job_001',
  ...overrides,
});

describe('PaymentProcessor', () => {
  let processor: PaymentProcessor;
  let paymentRepo: any;
  let providerFactory: any;
  let webhooksService: any;

  beforeEach(async () => {
    paymentRepo = {
      findOne: jest.fn(),
      update: jest.fn(),
    };

    providerFactory = {
      getProvider: jest.fn(),
    };

    webhooksService = {
      enqueueDispatch: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentProcessor,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: ProviderFactory, useValue: providerFactory },
        { provide: WebhooksService, useValue: webhooksService },
      ],
    }).compile();

    processor = module.get(PaymentProcessor);
  });

  describe('process() — process_charge', () => {
    it('marks payment as processing, calls provider, updates to success', async () => {
      const payment = mockPayment();
      paymentRepo.findOne.mockResolvedValue(payment);
      paymentRepo.update.mockResolvedValue(undefined);

      const mockProvider = {
        charge: jest.fn().mockResolvedValue({
          externalId: 'lenco_ext_001',
          status: 'success',
          providerResponse: { reference: 'lenco_ext_001' },
        }),
      };
      providerFactory.getProvider.mockReturnValue(mockProvider);

      const job = makeJob({ paymentId: payment.id });
      const result = await processor.process(job as any);

      // First update: mark processing
      expect(paymentRepo.update).toHaveBeenNthCalledWith(
        1,
        payment.id,
        expect.objectContaining({ status: PAYMENT_STATUS.PROCESSING }),
      );

      // Second update: mark success with externalId
      expect(paymentRepo.update).toHaveBeenNthCalledWith(
        2,
        payment.id,
        expect.objectContaining({
          status: PAYMENT_STATUS.SUCCESS,
          externalId: 'lenco_ext_001',
        }),
      );

      // Webhook dispatched
      expect(webhooksService.enqueueDispatch).toHaveBeenCalledWith(
        payment.id,
        'payment.success',
        expect.objectContaining({ status: PAYMENT_STATUS.SUCCESS }),
      );

      expect(result.status).toBe(PAYMENT_STATUS.SUCCESS);
    });

    it('marks payment FAILED when provider returns failed', async () => {
      const payment = mockPayment();
      paymentRepo.findOne.mockResolvedValue(payment);
      paymentRepo.update.mockResolvedValue(undefined);

      providerFactory.getProvider.mockReturnValue({
        charge: jest.fn().mockResolvedValue({
          externalId: 'lenco_ext_002',
          status: 'failed',
          providerResponse: {},
        }),
      });

      await processor.process(makeJob({ paymentId: payment.id }) as any);

      expect(paymentRepo.update).toHaveBeenCalledWith(
        payment.id,
        expect.objectContaining({ status: PAYMENT_STATUS.FAILED }),
      );
      expect(webhooksService.enqueueDispatch).toHaveBeenCalledWith(
        payment.id,
        'payment.failed',
        expect.any(Object),
      );
    });

    it('skips processing if payment already succeeded', async () => {
      paymentRepo.findOne.mockResolvedValue(mockPayment({ status: PAYMENT_STATUS.SUCCESS }));

      const result = await processor.process(
        makeJob({ paymentId: 'pay_proc_001' }) as any,
      );

      expect(result).toEqual({ skipped: true });
      expect(providerFactory.getProvider).not.toHaveBeenCalled();
    });

    it('throws (allowing BullMQ retry) when payment not found', async () => {
      paymentRepo.findOne.mockResolvedValue(null);

      await expect(
        processor.process(makeJob({ paymentId: 'nonexistent' }) as any),
      ).rejects.toThrow('not found');
    });

    it('propagates provider errors for BullMQ retry', async () => {
      paymentRepo.findOne.mockResolvedValue(mockPayment());
      paymentRepo.update.mockResolvedValue(undefined);

      providerFactory.getProvider.mockReturnValue({
        charge: jest.fn().mockRejectedValue(new Error('[Lenco] network timeout')),
      });

      await expect(
        processor.process(makeJob({ paymentId: 'pay_proc_001' }) as any),
      ).rejects.toThrow('[Lenco] network timeout');
    });
  });

  describe('onFailed()', () => {
    it('marks payment FAILED and dispatches webhook on retry exhaustion', async () => {
      paymentRepo.update.mockResolvedValue(undefined);

      const job = makeJob(
        { paymentId: 'pay_proc_001' },
        { attemptsMade: 4, opts: { attempts: 4 } },
      );

      processor.onFailed(job as any, new Error('card_declined'));

      // Allow microtasks to flush
      await new Promise(process.nextTick);

      expect(paymentRepo.update).toHaveBeenCalledWith(
        'pay_proc_001',
        expect.objectContaining({
          status: PAYMENT_STATUS.FAILED,
          failureReason: 'card_declined',
        }),
      );
      expect(webhooksService.enqueueDispatch).toHaveBeenCalledWith(
        'pay_proc_001',
        'payment.failed',
        expect.objectContaining({ error: 'card_declined' }),
      );
    });

    it('does NOT mark payment failed if retries remain', async () => {
      const job = makeJob(
        { paymentId: 'pay_proc_001' },
        { attemptsMade: 1, opts: { attempts: 4 } },
      );

      processor.onFailed(job as any, new Error('timeout'));

      await new Promise(process.nextTick);

      expect(paymentRepo.update).not.toHaveBeenCalled();
      expect(webhooksService.enqueueDispatch).not.toHaveBeenCalled();
    });
  });
});
