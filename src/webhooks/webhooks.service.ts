import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { QUEUES, WEBHOOK_JOBS, WEBHOOK_STATUS } from '../common/constants';

export interface WebhookPayload {
  event: string;
  resourceId: string;
  data: Record<string, any>;
  timestamp: number;
  deliveryId: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly signingSecret: string;

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepo: Repository<WebhookSubscription>,

    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,

    @InjectQueue(QUEUES.WEBHOOKS)
    private readonly webhooksQueue: Queue,

    private readonly config: ConfigService,
  ) {
    this.signingSecret = config.get<string>('webhook.signingSecret') ?? 'fallback';
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  async register(tenantId: string, url: string, events: string[]): Promise<WebhookSubscription> {
    const secret = crypto.randomBytes(32).toString('hex');
    const sub = this.subscriptionRepo.create({ tenantId, url, events, secret });
    await this.subscriptionRepo.save(sub);
    this.logger.log(`Webhook registered for ${tenantId}: ${url} (${events.join(', ')})`);
    return sub;
  }

  async listByTenant(tenantId: string): Promise<WebhookSubscription[]> {
    return this.subscriptionRepo.find({ where: { tenantId, isActive: true } });
  }

  async deactivate(id: string): Promise<void> {
    await this.subscriptionRepo.update(id, { isActive: false });
  }

  // ─── Dispatch ─────────────────────────────────────────────────────────────

  /**
   * Called after any payment/subscription state change.
   * Finds all active subscribers for the event and enqueues delivery jobs.
   */
  async enqueueDispatch(
    resourceId: string,
    event: string,
    data: Record<string, any>,
  ): Promise<void> {
    const subscriptions = await this.subscriptionRepo
      .createQueryBuilder('ws')
      .where('ws.isActive = true')
      .andWhere(':event = ANY(ws.events) OR \'*\' = ANY(ws.events)', { event })
      .getMany();

    if (subscriptions.length === 0) return;

    this.logger.log(`Dispatching ${event} to ${subscriptions.length} subscriber(s)`);

    for (const sub of subscriptions) {
      const delivery = await this.deliveryRepo.save(
        this.deliveryRepo.create({
          webhookSubscriptionId: sub.id,
          resourceId,
          event,
          payload: data,
          status: WEBHOOK_STATUS.PENDING,
        }),
      );

      await this.webhooksQueue.add(
        WEBHOOK_JOBS.DISPATCH,
        {
          deliveryId: delivery.id,
          subscriptionId: sub.id,
          url: sub.url,
          secret: sub.secret,
          event,
          resourceId,
          data,
        },
        {
          jobId: `webhook-${delivery.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: false,
          removeOnFail: false,
        },
      );
    }
  }

  /**
   * Actually sends the HTTP POST. Called by WebhookProcessor.
   */
  async send(
    deliveryId: string,
    url: string,
    secret: string,
    event: string,
    resourceId: string,
    data: Record<string, any>,
  ): Promise<void> {
    const timestamp = Date.now();
    const payload: WebhookPayload = { event, resourceId, data, timestamp, deliveryId };
    const signature = this.sign(payload, secret);

    await this.deliveryRepo.increment({ id: deliveryId }, 'attempts', 1);

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-Signature': signature,
          'X-Webhook-Delivery': deliveryId,
          'X-Webhook-Timestamp': timestamp.toString(),
        },
        timeout: 10_000,
      });

      await this.deliveryRepo.update(deliveryId, {
        status: WEBHOOK_STATUS.DELIVERED,
        lastHttpStatus: response.status,
        deliveredAt: new Date(),
      });

      this.logger.log(`Webhook delivered: ${deliveryId} → ${response.status}`);
    } catch (err) {
      const status = err.response?.status ?? 0;
      const message = err.message;

      await this.deliveryRepo.update(deliveryId, {
        status: WEBHOOK_STATUS.FAILED,
        lastHttpStatus: status,
        lastError: message,
      });

      this.logger.error(`Webhook failed: ${deliveryId} | ${status} | ${message}`);
      throw err; // Let BullMQ retry
    }
  }

  /**
   * Verify an incoming webhook signature (for providers like Lenco/Stripe sending to us).
   */
  verify(payload: string | Buffer, signature: string, secret?: string): boolean {
    const expected = this.sign(payload, secret ?? this.signingSecret);
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  async getDeliveries(resourceId: string): Promise<WebhookDelivery[]> {
    return this.deliveryRepo.find({
      where: { resourceId },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Signing ──────────────────────────────────────────────────────────────

  private sign(payload: any, secret: string): string {
    const body = typeof payload === 'string' || Buffer.isBuffer(payload)
      ? payload
      : JSON.stringify(payload);
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }
}
