import {
  Injectable,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { IDEMPOTENCY_STATUS } from '../common/constants';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  /**
   * Wraps an operation with idempotency guarantees.
   *
   * - If the key has never been seen: runs fn(), stores result, returns it.
   * - If the key exists and is COMPLETED: returns cached result (no-op).
   * - If the key exists and is PROCESSING: throws 409 (request in-flight).
   * - If the key exists and is FAILED: allows retry — re-runs fn().
   */
  async wrap<T>(
    key: string,
    fn: () => Promise<T>,
    requestPath?: string,
  ): Promise<T> {
    const existing = await this.repo.findOne({ where: { key } });

    if (existing) {
      if (existing.status === IDEMPOTENCY_STATUS.COMPLETED) {
        this.logger.log(`Idempotency hit (replay): ${key}`);
        return existing.response as T;
      }

      if (existing.status === IDEMPOTENCY_STATUS.PROCESSING) {
        this.logger.warn(`Idempotency conflict (in-flight): ${key}`);
        throw new ConflictException(
          `Request with idempotency key "${key}" is already being processed.`,
        );
      }

      // FAILED — allow retry with the same key
      this.logger.log(`Idempotency retry allowed for failed key: ${key}`);
    }

    // Mark as processing (upsert handles both insert and retry)
    await this.repo.upsert(
      { key, status: IDEMPOTENCY_STATUS.PROCESSING, requestPath, response: null },
      { conflictPaths: ['key'] },
    );

    try {
      const result = await fn();

      await this.repo.update(
        { key },
        {
          status: IDEMPOTENCY_STATUS.COMPLETED,
          response: result as any,
        },
      );

      return result;
    } catch (err) {
      await this.repo.update({ key }, { status: IDEMPOTENCY_STATUS.FAILED });
      throw err;
    }
  }

  async findByKey(key: string): Promise<IdempotencyKey | null> {
    return this.repo.findOne({ where: { key } });
  }

  async cleanupExpired(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const result = await this.repo
      .createQueryBuilder()
      .delete()
      .where('createdAt < :cutoff', { cutoff })
      .andWhere('status != :status', { status: IDEMPOTENCY_STATUS.PROCESSING })
      .execute();
    return result.affected ?? 0;
  }
}
