import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from '../../src/idempotency/idempotency.service';
import { IdempotencyKey } from '../../src/idempotency/entities/idempotency-key.entity';
import { IDEMPOTENCY_STATUS } from '../../src/common/constants';

const mockRepo = () => ({
  findOne: jest.fn(),
  upsert: jest.fn(),
  update: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyService,
        { provide: getRepositoryToken(IdempotencyKey), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(IdempotencyService);
    repo = module.get(getRepositoryToken(IdempotencyKey));
  });

  describe('wrap()', () => {
    it('runs fn() and stores result for a new key', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.upsert.mockResolvedValue(undefined);
      repo.update.mockResolvedValue(undefined);

      const fn = jest.fn().mockResolvedValue({ paymentId: 'abc' });

      const result = await service.wrap('idem_001', fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(repo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'idem_001', status: IDEMPOTENCY_STATUS.PROCESSING }),
        expect.anything(),
      );
      expect(repo.update).toHaveBeenCalledWith(
        { key: 'idem_001' },
        expect.objectContaining({ status: IDEMPOTENCY_STATUS.COMPLETED }),
      );
      expect(result).toEqual({ paymentId: 'abc' });
    });

    it('replays cached response for a completed key (no fn() call)', async () => {
      repo.findOne.mockResolvedValue({
        key: 'idem_001',
        status: IDEMPOTENCY_STATUS.COMPLETED,
        response: { paymentId: 'cached' },
      });

      const fn = jest.fn();
      const result = await service.wrap('idem_001', fn);

      expect(fn).not.toHaveBeenCalled();
      expect(result).toEqual({ paymentId: 'cached' });
    });

    it('throws 409 ConflictException for an in-flight key', async () => {
      repo.findOne.mockResolvedValue({
        key: 'idem_001',
        status: IDEMPOTENCY_STATUS.PROCESSING,
      });

      const fn = jest.fn();
      await expect(service.wrap('idem_001', fn)).rejects.toThrow(ConflictException);
      expect(fn).not.toHaveBeenCalled();
    });

    it('allows retry for a previously failed key', async () => {
      repo.findOne.mockResolvedValue({
        key: 'idem_001',
        status: IDEMPOTENCY_STATUS.FAILED,
      });
      repo.upsert.mockResolvedValue(undefined);
      repo.update.mockResolvedValue(undefined);

      const fn = jest.fn().mockResolvedValue({ ok: true });
      const result = await service.wrap('idem_001', fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true });
    });

    it('marks key as FAILED and rethrows when fn() throws', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.upsert.mockResolvedValue(undefined);
      repo.update.mockResolvedValue(undefined);

      const fn = jest.fn().mockRejectedValue(new Error('provider error'));

      await expect(service.wrap('idem_fail', fn)).rejects.toThrow('provider error');

      expect(repo.update).toHaveBeenCalledWith(
        { key: 'idem_fail' },
        { status: IDEMPOTENCY_STATUS.FAILED },
      );
    });
  });
});
