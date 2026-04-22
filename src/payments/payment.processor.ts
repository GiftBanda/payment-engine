import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { ProviderFactory } from '../providers/provider.factory';
import { WebhooksService } from '../webhooks/webhooks.service';
import { QUEUES, PAYMENT_JOBS, PAYMENT_STATUS } from '../common/constants';

interface ChargeJobData {
  paymentId: string;
}

@Processor(QUEUES.PAYMENTS)
export class PaymentProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    private readonly providerFactory: ProviderFactory,
    private readonly webhooksService: WebhooksService,
  ) {
    super();
  }

  async process(job: Job<ChargeJobData>): Promise<any> {
    switch (job.name) {
      case PAYMENT_JOBS.PROCESS_CHARGE:
        return this.handleCharge(job);
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async handleCharge(job: Job<ChargeJobData>) {
    const { paymentId } = job.data;
    const attempt = job.attemptsMade + 1;

    this.logger.log(`Processing charge: ${paymentId} (attempt ${attempt})`);

    const payment = await this.paymentRepo.findOne({ where: { id: paymentId } });

    if (!payment) {
      // Non-retryable — job data is corrupt
      throw new Error(`Payment ${paymentId} not found — skipping`);
    }

    if (payment.status === PAYMENT_STATUS.SUCCESS) {
      this.logger.log(`Payment ${paymentId} already succeeded — skipping`);
      return { skipped: true };
    }

    // Mark as processing
    await this.paymentRepo.update(paymentId, {
      status: PAYMENT_STATUS.PROCESSING,
      retryCount: attempt - 1,
    });

    const provider = this.providerFactory.getProvider(payment.provider);

    // Charge — BullMQ will auto-retry on throw (exponential backoff configured at enqueue time)
    const result = await provider.charge(payment);

    const finalStatus =
      result.status === 'success'
        ? PAYMENT_STATUS.SUCCESS
        : result.status === 'failed'
          ? PAYMENT_STATUS.FAILED
          : PAYMENT_STATUS.PENDING;

    await this.paymentRepo.update(paymentId, {
      status: finalStatus,
      externalId: result.externalId,
      providerResponse: result.providerResponse,
    });

    this.logger.log(`Payment ${paymentId} → ${finalStatus} (externalId: ${result.externalId})`);

    // Fire webhook asynchronously
    await this.webhooksService.enqueueDispatch(paymentId, `payment.${finalStatus}`, {
      paymentId,
      externalId: result.externalId,
      status: finalStatus,
      amount: payment.amount,
      currency: payment.currency,
      tenantId: payment.tenantId,
    });

    return { paymentId, status: finalStatus, externalId: result.externalId };
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ChargeJobData>, err: Error) {
    const { paymentId } = job.data;
    const isExhausted = job.attemptsMade >= (job.opts.attempts ?? 4);

    this.logger.error(
      `Job failed: ${paymentId} | attempt ${job.attemptsMade} | ${err.message}`,
    );

    if (isExhausted) {
      this.logger.error(`Payment ${paymentId} exhausted all retries — marking FAILED`);

      await this.paymentRepo.update(paymentId, {
        status: PAYMENT_STATUS.FAILED,
        failureReason: err.message,
      });

      await this.webhooksService.enqueueDispatch(paymentId, 'payment.failed', {
        paymentId,
        error: err.message,
        attemptsMade: job.attemptsMade,
      });
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job completed: ${job.id} in ${(job.processedOn ?? Date.now()) - job.timestamp}ms`);
  }
}
