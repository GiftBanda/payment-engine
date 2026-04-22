import { Test, TestingModule } from '@nestjs/testing';
import { WebhookProcessor } from '../../src/webhooks/webhook.processor';
import { WebhooksService } from '../../src/webhooks/webhooks.service';
import { WEBHOOK_JOBS } from '../../src/common/constants';

const makeJob = (name: string, data: any, overrides = {}) => ({
  name,
  data,
  attemptsMade: 0,
  opts: { attempts: 5 },
  id: 'wh_job_001',
  ...overrides,
});

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;
  let webhooksService: any;

  beforeEach(async () => {
    webhooksService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookProcessor,
        { provide: WebhooksService, useValue: webhooksService },
      ],
    }).compile();

    processor = module.get(WebhookProcessor);
  });

  describe('process()', () => {
    it('calls webhooksService.send with correct arguments', async () => {
      const job = makeJob(WEBHOOK_JOBS.DISPATCH, {
        deliveryId: 'del_001',
        subscriptionId: 'sub_001',
        url: 'https://acme.com/wh',
        secret: 'secret_abc',
        event: 'payment.success',
        resourceId: 'pay_001',
        data: { amount: 49900 },
      });

      await processor.process(job as any);

      expect(webhooksService.send).toHaveBeenCalledWith(
        'del_001',
        'https://acme.com/wh',
        'secret_abc',
        'payment.success',
        'pay_001',
        { amount: 49900 },
      );
    });

    it('does nothing for unknown job names', async () => {
      const job = makeJob('unknown_job', {});
      await processor.process(job as any);
      expect(webhooksService.send).not.toHaveBeenCalled();
    });

    it('propagates send() errors for BullMQ to retry', async () => {
      webhooksService.send.mockRejectedValueOnce(new Error('connection refused'));

      const job = makeJob(WEBHOOK_JOBS.DISPATCH, {
        deliveryId: 'del_002',
        url: 'https://acme.com/wh',
        secret: 'secret',
        event: 'payment.failed',
        resourceId: 'pay_002',
        data: {},
      });

      await expect(processor.process(job as any)).rejects.toThrow('connection refused');
    });
  });

  describe('onFailed()', () => {
    it('logs exhaustion message when all retries used up', () => {
      const logSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => {});

      const job = makeJob(
        WEBHOOK_JOBS.DISPATCH,
        { deliveryId: 'del_003' },
        { attemptsMade: 5, opts: { attempts: 5 } },
      );

      processor.onFailed(job as any, new Error('server error'));

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('EXHAUSTED'),
      );
    });

    it('logs failure without exhaustion message when retries remain', () => {
      const logSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => {});

      const job = makeJob(
        WEBHOOK_JOBS.DISPATCH,
        { deliveryId: 'del_004' },
        { attemptsMade: 2, opts: { attempts: 5 } },
      );

      processor.onFailed(job as any, new Error('timeout'));

      expect(logSpy).toHaveBeenCalledWith(
        expect.not.stringContaining('EXHAUSTED'),
      );
    });
  });
});
