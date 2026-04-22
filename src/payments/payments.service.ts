import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Payment } from './entities/payment.entity';
import { TransactionLog } from './entities/transaction-log.entity';import { CreatePaymentDto, PaymentFilterDto, RefundPaymentDto } from './dto/payment.dto';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { ProviderFactory } from '../providers/provider.factory';
import { PAYMENT_STATUS, QUEUES, PAYMENT_JOBS } from '../common/constants';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,

    @InjectRepository(TransactionLog)
    private readonly logRepo: Repository<TransactionLog>,

    @InjectQueue(QUEUES.PAYMENTS)
    private readonly paymentsQueue: Queue,

    private readonly idempotency: IdempotencyService,
    private readonly providerFactory: ProviderFactory,
  ) {}

  async create(dto: CreatePaymentDto): Promise<Payment> {
    return this.idempotency.wrap(
      dto.idempotencyKey,
      async () => {
        const payment = await this.paymentRepo.save(
          this.paymentRepo.create({
            tenantId: dto.tenantId,
            amount: dto.amount,
            currency: dto.currency,
            provider: dto.provider,
            idempotencyKey: dto.idempotencyKey,
            metadata: dto.metadata ?? {},
            subscriptionId: dto.subscriptionId,
            status: PAYMENT_STATUS.PENDING,
          }),
        );
        await this.log(payment, 'payment.created', undefined, payment);

        // Enqueue for async processing
        await this.paymentsQueue.add(
          PAYMENT_JOBS.PROCESS_CHARGE,
          { paymentId: payment.id },
          {
            jobId: `charge-${payment.id}`, // BullMQ dedup by jobId
            attempts: 4,
            backoff: { type: 'exponential', delay: 3000 },
            removeOnComplete: false,
            removeOnFail: false,
          },
        );

        this.logger.log(`Payment created + queued: ${payment.id}`);
        return payment;
      },
      'POST /payments',
    );
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { id } });
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  async findAll(filter: PaymentFilterDto): Promise<{ data: Payment[]; total: number }> {
    const where: FindManyOptions<Payment>['where'] = {};
    if (filter.tenantId) where['tenantId'] = filter.tenantId;
    if (filter.status) where['status'] = filter.status;
    if (filter.provider) where['provider'] = filter.provider;

    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);

    const [data, total] = await this.paymentRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  async refund(id: string, dto: RefundPaymentDto): Promise<Payment> {
    const payment = await this.findOne(id);

    if (payment.status !== PAYMENT_STATUS.SUCCESS) {
      throw new BadRequestException(
        `Cannot refund a payment with status "${payment.status}"`,
      );
    }

    if (dto.amount && dto.amount > payment.amount) {
      throw new BadRequestException('Refund amount exceeds original payment');
    }

    const provider = this.providerFactory.getProvider(payment.provider);
    const result = await provider.refund(payment, dto.amount);

    const prev = { status: payment.status };
    payment.status = PAYMENT_STATUS.REFUNDED;
    payment.providerResponse = { ...payment.providerResponse, refund: result.providerResponse };
    await this.paymentRepo.save(payment);

    await this.log(payment, 'payment.refunded', prev, { status: payment.status, refundId: result.externalRefundId });

    return payment;
  }

  async updateStatus(
    id: string,
    status: string,
    extras: Partial<Payment> = {},
  ): Promise<Payment> {
    const payment = await this.findOne(id);
    const prev = { status: payment.status };

    Object.assign(payment, { status, ...extras });
    await this.paymentRepo.save(payment);

    await this.log(payment, `payment.${status}`, prev, { status });
    return payment;
  }

  async getLogs(paymentId: string): Promise<TransactionLog[]> {
    return this.logRepo.find({
      where: { paymentId },
      order: { createdAt: 'ASC' },
    });
  }

  async syncStatus(id: string): Promise<Payment> {
    const payment = await this.findOne(id);

    if (!payment.externalId) {
      throw new BadRequestException('No external ID to sync status for');
    }

    const provider = this.providerFactory.getProvider(payment.provider);
    const result = await provider.getStatus(payment.externalId);

    const mappedStatus =
      result.status === 'success'
        ? PAYMENT_STATUS.SUCCESS
        : result.status === 'failed'
          ? PAYMENT_STATUS.FAILED
          : PAYMENT_STATUS.PENDING;

    return this.updateStatus(id, mappedStatus, {
      providerResponse: result.providerResponse,
    });
  }

  private async log(
    payment: Payment,
    event: string,
    previousState: Record<string, any> | undefined,
    newState: Record<string, any>,
  ): Promise<void> {
    const entry = new TransactionLog();
    entry.paymentId = payment.id;
    entry.tenantId = payment.tenantId;
    entry.event = event;
    entry.previousState = previousState ?? {};
    entry.newState = newState;
    entry.metadata = { provider: payment.provider, amount: payment.amount, currency: payment.currency };
    await this.logRepo.save(entry);
  }
}
