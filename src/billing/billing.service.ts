import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Plan } from './entities/plan.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentsService } from '../payments/payments.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CreatePlanDto, CreateSubscriptionDto, CancelSubscriptionDto } from './dto/billing.dto';
import { SUBSCRIPTION_STATUS, PAYMENT_PROVIDERS } from '../common/constants';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,

    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,

    private readonly paymentsService: PaymentsService,
    private readonly webhooksService: WebhooksService,
  ) {}

  // ─── Plans ────────────────────────────────────────────────────────────────

  async createPlan(dto: CreatePlanDto): Promise<Plan> {
    const plan = this.planRepo.create(dto);
    return this.planRepo.save(plan);
  }

  async listPlans(): Promise<Plan[]> {
    return this.planRepo.find({ where: { isActive: true }, order: { price: 'ASC' } });
  }

  async findPlan(id: string): Promise<Plan> {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Plan ${id} not found`);
    return plan;
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  async createSubscription(dto: CreateSubscriptionDto): Promise<Subscription> {
    const plan = await this.findPlan(dto.planId);

    const now = new Date();
    const periodEnd = this.addInterval(now, plan.interval, plan.intervalCount);

    const subscription = await this.subscriptionRepo.save(
      this.subscriptionRepo.create({
        tenantId: dto.tenantId,
        planId: dto.planId,
        paymentProvider: dto.paymentProvider,
        paymentMetadata: dto.paymentMetadata ?? {},
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      }),
    );

    // Charge immediately for first period
    await this.chargeSubscription(subscription, plan);

    await this.webhooksService.enqueueDispatch(
      subscription.id,
      'subscription.created',
      { subscriptionId: subscription.id, tenantId: dto.tenantId, planName: plan.name },
    );

    this.logger.log(`Subscription created: ${subscription.id} (${plan.name})`);
    return subscription;
  }

  async findSubscription(id: string): Promise<Subscription> {
    const sub = await this.subscriptionRepo.findOne({ where: { id }, relations: ['plan'] });
    if (!sub) throw new NotFoundException(`Subscription ${id} not found`);
    return sub;
  }

  async listByTenant(tenantId: string): Promise<Subscription[]> {
    return this.subscriptionRepo.find({
      where: { tenantId },
      relations: ['plan'],
      order: { createdAt: 'DESC' },
    });
  }

  async cancelSubscription(id: string, dto: CancelSubscriptionDto): Promise<Subscription> {
    const subscription = await this.findSubscription(id);

    if (subscription.status === SUBSCRIPTION_STATUS.CANCELLED) {
      throw new BadRequestException('Subscription is already cancelled');
    }

    if (dto.cancelAtPeriodEnd) {
      // Grace-period cancel: stays active until period ends, scheduler handles the rest
      subscription.cancellationReason = dto.reason ?? '';
      await this.subscriptionRepo.save(subscription);
      this.logger.log(`Subscription ${id} set to cancel at period end`);
    } else {
      // Immediate cancel
      subscription.status = SUBSCRIPTION_STATUS.CANCELLED;
      subscription.cancelledAt = new Date();
      subscription.cancellationReason = dto.reason ?? '';
      await this.subscriptionRepo.save(subscription);
    }

    await this.webhooksService.enqueueDispatch(id, 'subscription.cancelled', {
      subscriptionId: id,
      tenantId: subscription.tenantId,
      cancelAtPeriodEnd: dto.cancelAtPeriodEnd,
    });

    return subscription;
  }

  // ─── Renewal Scheduler ────────────────────────────────────────────────────

  /**
   * Runs every hour — finds subscriptions due for renewal and charges them.
   * BullMQ handles concurrency; the cron just enqueues work.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processRenewals() {
    const now = new Date();
    const due = await this.subscriptionRepo.find({
      where: {
        status: SUBSCRIPTION_STATUS.ACTIVE,
        currentPeriodEnd: LessThanOrEqual(now),
      },
      relations: ['plan'],
    });

    if (due.length === 0) return;

    this.logger.log(`Processing ${due.length} subscription renewals`);

    for (const sub of due) {
      await this.renewSubscription(sub).catch((err) =>
        this.logger.error(`Renewal failed for ${sub.id}: ${err.message}`),
      );
    }
  }

  async renewSubscription(subscription: Subscription): Promise<void> {
    const plan = subscription.plan;

    try {
      await this.chargeSubscription(subscription, plan);

      // Advance billing period
      const newStart = new Date(subscription.currentPeriodEnd);
      const newEnd = this.addInterval(newStart, plan.interval, plan.intervalCount);

      await this.subscriptionRepo.update(subscription.id, {
        currentPeriodStart: newStart,
        currentPeriodEnd: newEnd,
        failedPaymentCount: 0,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      });

      await this.webhooksService.enqueueDispatch(subscription.id, 'subscription.renewed', {
        subscriptionId: subscription.id,
        tenantId: subscription.tenantId,
        newPeriodEnd: newEnd,
      });

      this.logger.log(`Renewed subscription ${subscription.id}`);
    } catch (err) {
      const failCount = subscription.failedPaymentCount + 1;

      await this.subscriptionRepo.update(subscription.id, {
        failedPaymentCount: failCount,
        status: failCount >= 3 ? SUBSCRIPTION_STATUS.CANCELLED : SUBSCRIPTION_STATUS.PAST_DUE,
      });

      this.logger.error(`Renewal charge failed for ${subscription.id} (attempt ${failCount}): ${err.message}`);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async chargeSubscription(subscription: Subscription, plan: Plan): Promise<void> {
    const idempotencyKey = `sub_${subscription.id}_${subscription.currentPeriodEnd.getTime()}`;

    await this.paymentsService.create({
      tenantId: subscription.tenantId,
      amount: plan.price,
      currency: plan.currency,
      provider: subscription.paymentProvider,
      idempotencyKey,
      subscriptionId: subscription.id,
      metadata: subscription.paymentMetadata,
    });
  }

  private addInterval(date: Date, interval: string, count: number): Date {
    const d = new Date(date);
    if (interval === 'month') d.setMonth(d.getMonth() + count);
    else if (interval === 'year') d.setFullYear(d.getFullYear() + count);
    else if (interval === 'day') d.setDate(d.getDate() + count);
    return d;
  }
}
