import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProviderFactory } from '../../src/providers/provider.factory';
import { LencoProvider } from '../../src/providers/lenco.provider';
import { StripeProvider } from '../../src/providers/stripe.provider';
import { PAYMENT_PROVIDERS } from '../../src/common/constants';

const mockConfigService = () => ({
  get: jest.fn((key: string) => {
    const map: Record<string, string> = {
      'lenco.baseUrl': 'https://api.lenco.co/access/v1',
      'lenco.secretKey': 'test_lenco_key',
      'stripe.secretKey': 'sk_test_mock',
    };
    return map[key];
  }),
});

describe('ProviderFactory', () => {
  let factory: ProviderFactory;
  let lenco: LencoProvider;
  let stripe: StripeProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderFactory,
        LencoProvider,
        StripeProvider,
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();

    factory = module.get(ProviderFactory);
    lenco = module.get(LencoProvider);
    stripe = module.get(StripeProvider);
  });

  it('returns LencoProvider for "lenco"', () => {
    const provider = factory.getProvider(PAYMENT_PROVIDERS.LENCO);
    expect(provider).toBeInstanceOf(LencoProvider);
  });

  it('returns StripeProvider for "stripe"', () => {
    const provider = factory.getProvider(PAYMENT_PROVIDERS.STRIPE);
    expect(provider).toBeInstanceOf(StripeProvider);
  });

  it('throws for an unknown provider', () => {
    expect(() => factory.getProvider('paypal')).toThrow('Unknown payment provider: "paypal"');
  });
});

describe('StripeProvider (mock)', () => {
  let provider: StripeProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StripeProvider,
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();

    provider = module.get(StripeProvider);
  });

  const mockPayment: any = {
    id: 'pay_001',
    amount: 49900,
    currency: 'USD',
    idempotencyKey: 'idem_stripe_001',
    tenantId: 'tenant_acme',
    metadata: { paymentMethodId: 'pm_mock_123' },
  };

  it('charge() returns externalId and success status', async () => {
    // Override random to force success (not the 10% failure path)
    jest.spyOn(Math, 'random').mockReturnValue(0.5);

    const result = await provider.charge(mockPayment);

    expect(result.externalId).toMatch(/^pi_mock_/);
    expect(result.status).toBe('success');
    expect(result.providerResponse).toHaveProperty('id');

    jest.spyOn(Math, 'random').mockRestore();
  });

  it('charge() throws on simulated card decline', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.05); // < 0.1 → fail

    await expect(provider.charge(mockPayment)).rejects.toThrow('card_declined');

    jest.spyOn(Math, 'random').mockRestore();
  });

  it('refund() returns a valid refund ID', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    const chargeResult = await provider.charge(mockPayment);
    jest.spyOn(Math, 'random').mockRestore();

    const refundPayment = { ...mockPayment, externalId: chargeResult.externalId };
    const result = await provider.refund(refundPayment as any, 10000);

    expect(result.externalRefundId).toMatch(/^re_mock_/);
    expect(result.status).toBe('success');
  });
});
