import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { WebhookSubscription } from '../../src/webhooks/entities/webhook-subscription.entity';
import { WebhookDelivery } from '../../src/webhooks/entities/webhook-delivery.entity';
import { QUEUES } from '../../src/common/constants';
import * as crypto from 'crypto';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((e) => e),
  save: jest.fn((e) => Promise.resolve({ id: 'del_001', ...e })),
  update: jest.fn(),
  increment: jest.fn(),
  createQueryBuilder: jest.fn().mockReturnValue({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  }),
});

const mockQueue = () => ({ add: jest.fn() });

describe('WebhooksService', () => {
  let service: WebhooksService;
  let subRepo: ReturnType<typeof mockRepo>;
  let deliveryRepo: ReturnType<typeof mockRepo>;
  let queue: ReturnType<typeof mockQueue>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: getRepositoryToken(WebhookSubscription), useFactory: mockRepo },
        { provide: getRepositoryToken(WebhookDelivery), useFactory: mockRepo },
        { provide: getQueueToken(QUEUES.WEBHOOKS), useFactory: mockQueue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-signing-secret-32-chars-long!') },
        },
      ],
    }).compile();

    service = module.get(WebhooksService);
    subRepo = module.get(getRepositoryToken(WebhookSubscription));
    deliveryRepo = module.get(getRepositoryToken(WebhookDelivery));
    queue = module.get(getQueueToken(QUEUES.WEBHOOKS));
  });

  describe('register()', () => {
    it('generates a random secret and saves the subscription', async () => {
      subRepo.save.mockImplementation((entity) =>
        Promise.resolve({ id: 'sub_001', ...entity }),
      );

      const result = await service.register(
        'tenant_acme',
        'https://acme.com/webhooks',
        ['payment.success'],
      );

      expect(subRepo.save).toHaveBeenCalled();
      expect(result.tenantId).toBe('tenant_acme');
      expect(result.url).toBe('https://acme.com/webhooks');
      expect(result.events).toEqual(['payment.success']);
      // Secret should be a 64-char hex string (32 random bytes)
      expect(result.secret).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('enqueueDispatch()', () => {
    it('does nothing when no subscribers match the event', async () => {
      subRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      await service.enqueueDispatch('pay_001', 'payment.success', {});

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('creates a delivery record and enqueues a job per subscriber', async () => {
      const subscribers = [
        { id: 'sub_001', url: 'https://a.com/wh', secret: 'secret1' },
        { id: 'sub_002', url: 'https://b.com/wh', secret: 'secret2' },
      ];

      subRepo.createQueryBuilder = jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(subscribers),
      });

      await service.enqueueDispatch('pay_001', 'payment.success', { amount: 49900 });

      expect(deliveryRepo.save).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledTimes(2);
      expect(queue.add).toHaveBeenCalledWith(
        'dispatch_webhook',
        expect.objectContaining({ event: 'payment.success', resourceId: 'pay_001' }),
        expect.objectContaining({ attempts: 5 }),
      );
    });
  });

  describe('verify()', () => {
    it('returns true for a valid HMAC-SHA256 signature', () => {
      const payload = JSON.stringify({ event: 'payment.success', paymentId: 'pay_001' });
      const secret = 'test-signing-secret-32-chars-long!';
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      const result = service.verify(payload, signature, secret);
      expect(result).toBe(true);
    });

    it('returns false for a tampered payload', () => {
      const secret = 'test-signing-secret-32-chars-long!';
      const original = JSON.stringify({ event: 'payment.success' });
      const signature = crypto.createHmac('sha256', secret).update(original).digest('hex');

      const tampered = JSON.stringify({ event: 'payment.failed' });
      const result = service.verify(tampered, signature, secret);
      expect(result).toBe(false);
    });

    it('returns false for a wrong secret', () => {
      const payload = JSON.stringify({ event: 'payment.success' });
      const goodSig = crypto.createHmac('sha256', 'good-secret').update(payload).digest('hex');

      const result = service.verify(payload, goodSig, 'wrong-secret');
      expect(result).toBe(false);
    });
  });
});
