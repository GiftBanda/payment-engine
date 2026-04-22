import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhooksService } from './webhooks.service';
import { QUEUES, WEBHOOK_JOBS } from '../common/constants';

interface WebhookJobData {
  deliveryId: string;
  subscriptionId: string;
  url: string;
  secret: string;
  event: string;
  resourceId: string;
  data: Record<string, any>;
}

@Processor(QUEUES.WEBHOOKS)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly webhooksService: WebhooksService) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<any> {
    if (job.name !== WEBHOOK_JOBS.DISPATCH) return;

    const { deliveryId, url, secret, event, resourceId, data } = job.data;

    this.logger.log(`Sending webhook: ${event} → ${url} (attempt ${job.attemptsMade + 1})`);

    await this.webhooksService.send(deliveryId, url, secret, event, resourceId, data);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    const isExhausted = job.attemptsMade >= (job.opts.attempts ?? 5);
    this.logger.error(
      `Webhook job failed: ${job.data.deliveryId} | ${err.message}` +
      (isExhausted ? ' — EXHAUSTED, no more retries' : ''),
    );
  }
}
