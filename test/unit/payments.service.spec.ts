import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from '../../src/payments/payments.service';
import { Payment } from '../../src/payments/entities/payment.entity';
import { TransactionLog } from '../../src/payments/entities/transaction-log.entity';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { ProviderFactory } from '../../src/providers/provider.factory';
import { QUEUES, PAYMENT_STATUS } from '../../src/common/constants';

const mockRepo = () => ({
  create: jest.fn((dto) => dto),
  save: jest.fn((entity) => Promise.resolve({ id: 'pay_test_001', ...entity })),
  findOne: jest.fn(),
  findAndCount: jest.fn(),
  update: jest.fn(),
});

const mockQueue = () => ({ add: jest.fn() });

const mockIdempotency = () => ({
  wrap: jest.fn((key, fn) => fn()),
});

const mockProviderFactory = () => ({
  getProvider: jest.fn(),
});

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentRepo: ReturnType<typeof mockRepo>;
  let logRepo: ReturnType<typeof mockRepo>;
  let queue: ReturnType<typeof mockQueue>;
  let idempotency: ReturnType<typeof mockIdempotency>;
  let providerFactory: ReturnType<typeof mockProviderFactory>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useFactory: mockRepo },
        { provide: getRepositoryToken(TransactionLog), useFactory: mockRepo },
        { provide: getQueueToken(QUEUES.PAYMENTS), useFactory: mockQueue },
        { provide: IdempotencyService, useFactory: mockIdempotency },
        { provide: ProviderFactory, useFactory: mockProviderFactory },
      ],
    }).compile();

    service = module.get(PaymentsService);
    paymentRepo = module.get(getRepositoryToken(Payment));
    logRepo = module.get(getRepositoryToken(TransactionLog));
    queue = module.get(getQueueToken(QUEUES.PAYMENTS));
    idempotency = module.get(IdempotencyService);
    providerFactory = module.get(ProviderFactory);
  });

  describe('create()', () => {
    const dto = {
      tenantId: 'tenant_acme',
      amount: 49900,
      currency: 'ZMW',
      provider: 'lenco',
      idempotencyKey: 'idem_acme_001',
      metadata: { accountNumber: '1234567890' },
    };

    beforeEach(() => {
      // repo.create returns the plain object, repo.save returns it with a real id
      paymentRepo.create.mockImplementation((d) => d);
      paymentRepo.save.mockImplementation((entity) =>
        Promise.resolve({ id: 'pay_test_001', ...entity }),
      );
      logRepo.create = jest.fn((e) => e);
      logRepo.save = jest.fn().mockResolvedValue({});
    });

    it('creates payment and enqueues charge job', async () => {
      await service.create(dto);

      expect(paymentRepo.save).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        'process_charge',
        { paymentId: 'pay_test_001' },
        expect.objectContaining({ attempts: 4 }),
      );
    });

    it('delegates to idempotency service', async () => {
      await service.create(dto);

      expect(idempotency.wrap).toHaveBeenCalledWith(
        dto.idempotencyKey,
        expect.any(Function),
        'POST /payments',
      );
    });
  });

  describe('findOne()', () => {
    it('returns payment when found', async () => {
      const payment = { id: 'pay_001', tenantId: 'tenant_acme', status: PAYMENT_STATUS.PENDING };
      paymentRepo.findOne.mockResolvedValue(payment);

      const result = await service.findOne('pay_001');
      expect(result).toEqual(payment);
    });

    it('throws NotFoundException when payment does not exist', async () => {
      paymentRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('refund()', () => {
    const successPayment = {
      id: 'pay_001',
      status: PAYMENT_STATUS.SUCCESS,
      amount: 49900,
      provider: 'lenco',
      providerResponse: {},
      externalId: 'lenco_ext_001',
    };

    it('calls provider refund and updates status', async () => {
      paymentRepo.findOne.mockResolvedValue(successPayment);
      paymentRepo.save.mockResolvedValue({ ...successPayment, status: PAYMENT_STATUS.REFUNDED });
      logRepo.create = jest.fn((e) => e);
      logRepo.save = jest.fn();

      const mockProvider = {
        refund: jest.fn().mockResolvedValue({
          externalRefundId: 're_001',
          status: 'success',
          providerResponse: {},
        }),
      };
      providerFactory.getProvider.mockReturnValue(mockProvider);

      const result = await service.refund('pay_001', {});

      expect(mockProvider.refund).toHaveBeenCalled();
      expect(result.status).toBe(PAYMENT_STATUS.REFUNDED);
    });

    it('throws BadRequestException when payment is not successful', async () => {
      paymentRepo.findOne.mockResolvedValue({
        ...successPayment,
        status: PAYMENT_STATUS.PENDING,
      });

      await expect(service.refund('pay_001', {})).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when refund amount exceeds payment', async () => {
      paymentRepo.findOne.mockResolvedValue(successPayment);

      await expect(
        service.refund('pay_001', { amount: 99999 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findAll()', () => {
    it('returns paginated results', async () => {
      const payments = [{ id: 'pay_001' }, { id: 'pay_002' }];
      paymentRepo.findAndCount.mockResolvedValue([payments, 2]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual({ data: payments, total: 2 });
    });
  });
});
