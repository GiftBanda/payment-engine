import { Injectable } from '@nestjs/common';
import { LencoProvider } from './lenco.provider';
import { StripeProvider } from './stripe.provider';
import { IPaymentProvider } from './provider.interface';
import { PAYMENT_PROVIDERS } from '../common/constants';

@Injectable()
export class ProviderFactory {
  constructor(
    private readonly lenco: LencoProvider,
    private readonly stripe: StripeProvider,
  ) {}

  getProvider(providerName: string): IPaymentProvider {
    switch (providerName) {
      case PAYMENT_PROVIDERS.LENCO:
        return this.lenco;
      case PAYMENT_PROVIDERS.STRIPE:
        return this.stripe;
      default:
        throw new Error(`Unknown payment provider: "${providerName}"`);
    }
  }
}
