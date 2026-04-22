import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Payment } from './entities/payment.entity';
import { TransactionLog } from './entities/transaction-log.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentProcessor } from './payment.processor';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { ProvidersModule } from '../providers/providers.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { QUEUES } from '../common/constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, TransactionLog]),
    BullModule.registerQueue({ name: QUEUES.PAYMENTS }),
    IdempotencyModule,
    ProvidersModule,
    WebhooksModule,
  ],
  providers: [PaymentsService, PaymentProcessor],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
