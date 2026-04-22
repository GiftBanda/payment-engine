import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { QUEUES } from '../common/constants';

/**
 * Mounts the Bull Board UI at /admin/queues
 *
 * Shows live job counts, retries, failures, and payloads for every queue.
 * Protect this route in production — add IP allowlist or basic auth in front.
 */
@Module({
  imports: [
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
    }),

    BullBoardModule.forFeature({
      name: QUEUES.PAYMENTS,
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: QUEUES.WEBHOOKS,
      adapter: BullMQAdapter,
    }),

    BullBoardModule.forFeature({
      name: QUEUES.BILLING,
      adapter: BullMQAdapter,
    }),

    // Register queues so BullBoard can attach to them
    BullModule.registerQueue(
      { name: QUEUES.PAYMENTS },
      { name: QUEUES.WEBHOOKS },
      { name: QUEUES.BILLING },
    ),
  ],
})
export class QueueDashboardModule {}
