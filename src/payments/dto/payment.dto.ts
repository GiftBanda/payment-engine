import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  IsObject,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_PROVIDERS } from '../../common/constants';

export class CreatePaymentDto {
  @ApiProperty({ example: 'tenant_acme_corp' })
  @IsString()
  @MaxLength(100)
  tenantId: string;

  @ApiProperty({ example: 49900, description: 'Amount in smallest unit (ngwee/cents)' })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ example: 'ZMW', enum: ['ZMW', 'USD', 'ZAR', 'KES'] })
  @IsString()
  currency: string;

  @ApiProperty({ enum: Object.values(PAYMENT_PROVIDERS) })
  @IsEnum(Object.values(PAYMENT_PROVIDERS))
  provider: string;

  @ApiProperty({ example: 'idem_acme_2025_04_22_001', description: 'Unique key — safe to retry with same key' })
  @IsString()
  @MaxLength(255)
  idempotencyKey: string;

  @ApiPropertyOptional({ description: 'Provider-specific metadata (account numbers, payment method IDs, etc.)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subscriptionId?: string;
}

export class RefundPaymentDto {
  @ApiProperty({ example: 10000, description: 'Amount to refund in smallest unit. Omit for full refund.' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  amount?: number;

  @ApiPropertyOptional({ example: 'Customer request' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class PaymentFilterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tenantId?: string;

  @ApiPropertyOptional({ enum: ['pending', 'processing', 'success', 'failed', 'refunded', 'cancelled'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  limit?: number = 20;
}
