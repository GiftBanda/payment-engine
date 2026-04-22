import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IPaymentProvider, ChargeResult, RefundResult, PaymentStatusResult } from './provider.interface';
import { Payment } from '../payments/entities/payment.entity';
import { v4 as uuidv4 } from 'uuid';

/**
 * Mock Stripe-like provider.
 *
 * In production, replace the mock logic with:
 *   npm install stripe
 *   const stripe = new Stripe(secretKey, { apiVersion: '2024-04-10' });
 *
 * The interface contract stays identical — only the internals change.
 */
@Injectable()
export class StripeProvider implements IPaymentProvider {
  private readonly logger = new Logger(StripeProvider.name);
  private readonly secretKey: string;

  // In-memory store for mock — replace with actual Stripe SDK calls
  private readonly mockStore = new Map<string, any>();

  constructor(private readonly config: ConfigService) {
    this.secretKey = config.get<string>('stripe.secretKey') ?? '';
  }

  async charge(payment: Payment): Promise<ChargeResult> {
    this.logger.log(`Stripe charge: ${payment.id} | ${payment.amount} ${payment.currency}`);

    // ─── MOCK IMPLEMENTATION ─────────────────────────────────────────────────
    // Simulate ~10% failure rate for realism
    const shouldFail = Math.random() < 0.1;

    if (shouldFail) {
      throw new Error('[Stripe] card_declined: insufficient_funds');
    }

    const paymentIntentId = `pi_mock_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    const intent = {
      id: paymentIntentId,
      object: 'payment_intent',
      amount: payment.amount,
      currency: payment.currency.toLowerCase(),
      status: 'succeeded',
      payment_method: payment.metadata?.paymentMethodId,
      idempotency_key: payment.idempotencyKey, // Stripe stores this natively
      created: Math.floor(Date.now() / 1000),
    };

    this.mockStore.set(paymentIntentId, intent);
    // ─────────────────────────────────────────────────────────────────────────

    // In production with real Stripe SDK:
    // const intent = await stripe.paymentIntents.create({
    //   amount: payment.amount,
    //   currency: payment.currency.toLowerCase(),
    //   payment_method: payment.metadata?.paymentMethodId,
    //   confirm: true,
    // }, { idempotencyKey: payment.idempotencyKey });

    return {
      externalId: intent.id,
      status: this.mapStatus(intent.status),
      providerResponse: intent,
    };
  }

  async refund(payment: Payment, amount?: number): Promise<RefundResult> {
    this.logger.log(`Stripe refund: ${payment.externalId}`);

    const refundId = `re_mock_${uuidv4().replace(/-/g, '').slice(0, 24)}`;

    const refund = {
      id: refundId,
      object: 'refund',
      amount: amount ?? payment.amount,
      payment_intent: payment.externalId,
      status: 'succeeded',
    };

    // Real: const refund = await stripe.refunds.create({ payment_intent: payment.externalId, amount });

    return {
      externalRefundId: refund.id,
      status: 'success',
      providerResponse: refund,
    };
  }

  async getStatus(externalId: string): Promise<PaymentStatusResult> {
    const intent = this.mockStore.get(externalId);

    // Real: const intent = await stripe.paymentIntents.retrieve(externalId);

    return {
      externalId,
      status: intent ? this.mapStatus(intent.status) : 'pending',
      providerResponse: intent ?? {},
    };
  }

  private mapStatus(stripeStatus: string): 'pending' | 'success' | 'failed' {
    const map: Record<string, 'pending' | 'success' | 'failed'> = {
      requires_payment_method: 'pending',
      requires_confirmation: 'pending',
      requires_action: 'pending',
      processing: 'pending',
      succeeded: 'success',
      canceled: 'failed',
      requires_capture: 'pending',
    };
    return map[stripeStatus] ?? 'pending';
  }
}
