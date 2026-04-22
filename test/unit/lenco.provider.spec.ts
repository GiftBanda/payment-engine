import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LencoProvider } from '../../src/providers/lenco.provider';
import axios from 'axios';

jest.mock('axios', () => ({
  create: jest.fn().mockReturnValue({
    post: jest.fn(),
    get: jest.fn(),
  }),
}));

const mockAxiosInstance = (axios.create as jest.Mock)();

const mockPayment: any = {
  id: 'pay_lenco_001',
  amount: 49900,
  currency: 'ZMW',
  idempotencyKey: 'idem_lenco_001',
  tenantId: 'tenant_acme',
  externalId: 'lenco_ref_abc',
  metadata: {
    accountNumber: '1234567890',
    bankCode: '057',
    beneficiaryName: 'Acme Corp',
  },
};

describe('LencoProvider', () => {
  let provider: LencoProvider;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LencoProvider,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => ({
              'lenco.baseUrl': 'https://api.lenco.co/access/v1',
              'lenco.secretKey': 'test_lenco_key',
            }[key]),
          },
        },
      ],
    }).compile();

    provider = module.get(LencoProvider);
  });

  describe('charge()', () => {
    it('calls POST /transfer and maps successful response', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: { reference: 'lenco_ref_001', status: 'successful' },
          status: 'success',
        },
      });

      const result = await provider.charge(mockPayment);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/transfer',
        expect.objectContaining({
          amount: 499,         // divided by 100
          currency: 'ZMW',
          reference: 'idem_lenco_001',
          account_number: '1234567890',
        }),
      );
      expect(result.externalId).toBe('lenco_ref_001');
      expect(result.status).toBe('success');
    });

    it('maps "pending" status correctly', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { data: { reference: 'lenco_ref_002', status: 'pending' } },
      });

      const result = await provider.charge(mockPayment);
      expect(result.status).toBe('pending');
    });

    it('maps "processing" to pending', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { data: { reference: 'lenco_ref_003', status: 'processing' } },
      });

      const result = await provider.charge(mockPayment);
      expect(result.status).toBe('pending');
    });

    it('maps "failed" status correctly', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { data: { reference: 'lenco_ref_004', status: 'failed' } },
      });

      const result = await provider.charge(mockPayment);
      expect(result.status).toBe('failed');
    });

    it('throws normalised error on API failure', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        message: 'network error',
        response: { data: { message: 'Insufficient balance' } },
      });

      await expect(provider.charge(mockPayment)).rejects.toThrow('[Lenco] Insufficient balance');
    });

    it('throws normalised error when no response body', async () => {
      mockAxiosInstance.post.mockRejectedValue({ message: 'timeout' });

      await expect(provider.charge(mockPayment)).rejects.toThrow('[Lenco] timeout');
    });
  });

  describe('refund()', () => {
    it('calls POST /refund with external reference', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { data: { reference: 'refund_ref_001' } },
      });

      const result = await provider.refund(mockPayment, 10000);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/refund',
        expect.objectContaining({
          reference: 'lenco_ref_abc',
          amount: 100,   // 10000 / 100
        }),
      );
      expect(result.status).toBe('success');
    });

    it('sends undefined amount for full refund', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { data: { reference: 'refund_ref_002' } },
      });

      await provider.refund(mockPayment);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/refund',
        expect.objectContaining({ amount: undefined }),
      );
    });

    it('throws normalised error on refund failure', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        message: 'refund failed',
        response: { data: { error: 'Transaction not found' } },
      });

      await expect(provider.refund(mockPayment)).rejects.toThrow('[Lenco] Transaction not found');
    });
  });

  describe('getStatus()', () => {
    it('calls GET /transaction/:id and returns mapped status', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: { status: 'successful' } },
      });

      const result = await provider.getStatus('lenco_ref_abc');

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/transaction/lenco_ref_abc');
      expect(result.status).toBe('success');
      expect(result.externalId).toBe('lenco_ref_abc');
    });

    it('maps "reversed" to failed', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: { status: 'reversed' } },
      });

      const result = await provider.getStatus('lenco_ref_xyz');
      expect(result.status).toBe('failed');
    });

    it('maps unknown status to pending (safe default)', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { data: { status: 'some_unknown_status' } },
      });

      const result = await provider.getStatus('lenco_ref_xyz');
      expect(result.status).toBe('pending');
    });
  });
});
