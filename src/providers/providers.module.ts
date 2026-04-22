import { Module } from '@nestjs/common';
import { LencoProvider } from './lenco.provider';
import { StripeProvider } from './stripe.provider';
import { ProviderFactory } from './provider.factory';

@Module({
  providers: [LencoProvider, StripeProvider, ProviderFactory],
  exports: [ProviderFactory],
})
export class ProvidersModule {}
