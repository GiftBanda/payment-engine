import { Payment } from '../payments/entities/payment.entity';

export interface ChargeResult {
  externalId: string;
  status: 'pending' | 'success' | 'failed';
  providerResponse: Record<string, any>;
}

export interface RefundResult {
  externalRefundId: string;
  status: 'success' | 'failed';
  providerResponse: Record<string, any>;
}

export interface PaymentStatusResult {
  externalId: string;
  status: 'pending' | 'success' | 'failed';
  providerResponse: Record<string, any>;
}

export interface IPaymentProvider {
  charge(payment: Payment): Promise<ChargeResult>;
  refund(payment: Payment, amount?: number): Promise<RefundResult>;
  getStatus(externalId: string): Promise<PaymentStatusResult>;
}
