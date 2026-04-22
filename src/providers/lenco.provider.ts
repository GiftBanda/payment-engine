import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { IPaymentProvider, ChargeResult, RefundResult, PaymentStatusResult } from './provider.interface';
import { Payment } from '../payments/entities/payment.entity';

@Injectable()
export class LencoProvider implements IPaymentProvider {
  private readonly logger = new Logger(LencoProvider.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get('lenco.baseUrl'),
      headers: {
        Authorization: `Bearer ${config.get('lenco.secretKey')}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });
  }

  async charge(payment: Payment): Promise<ChargeResult> {
    this.logger.log(`Lenco charge: ${payment.id} | ${payment.amount} ${payment.currency}`);

    try {
      const payload = {
        amount: payment.amount / 100, // Lenco expects decimal
        currency: payment.currency,
        reference: payment.idempotencyKey, // Lenco native deduplication
        narration: `Payment ${payment.id} for tenant ${payment.tenantId}`,
        account_number: payment.metadata?.accountNumber,
        bank_code: payment.metadata?.bankCode,
        beneficiary_name: payment.metadata?.beneficiaryName,
      };

      const { data } = await this.client.post('/transfer', payload);

      return {
        externalId: data.data?.reference || data.reference,
        status: this.mapStatus(data.data?.status || data.status),
        providerResponse: data,
      };
    } catch (err) {
      this.logger.error(`Lenco charge failed: ${err.message}`, err.response?.data);
      throw this.normalizeError(err);
    }
  }

  async refund(payment: Payment, amount?: number): Promise<RefundResult> {
    this.logger.log(`Lenco refund: ${payment.externalId}`);

    try {
      const { data } = await this.client.post('/refund', {
        reference: payment.externalId,
        amount: amount ? amount / 100 : undefined,
      });

      return {
        externalRefundId: data.data?.reference,
        status: 'success',
        providerResponse: data,
      };
    } catch (err) {
      this.logger.error(`Lenco refund failed: ${err.message}`);
      throw this.normalizeError(err);
    }
  }

  async getStatus(externalId: string): Promise<PaymentStatusResult> {
    try {
      const { data } = await this.client.get(`/transaction/${externalId}`);

      return {
        externalId,
        status: this.mapStatus(data.data?.status),
        providerResponse: data,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private mapStatus(lencoStatus: string): 'pending' | 'success' | 'failed' {
    const map: Record<string, 'pending' | 'success' | 'failed'> = {
      pending: 'pending',
      processing: 'pending',
      successful: 'success',
      completed: 'success',
      failed: 'failed',
      reversed: 'failed',
    };
    return map[lencoStatus?.toLowerCase()] ?? 'pending';
  }

  private normalizeError(err: any): Error {
    const message =
      err.response?.data?.message ||
      err.response?.data?.error ||
      err.message ||
      'Lenco provider error';
    return new Error(`[Lenco] ${message}`);
  }
}
