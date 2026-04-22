import {
  ArrayMaxSize,
  IsArray,
  IsString,
  IsNumber,
  IsOptional,
  IsIn,
  IsObject,
  Min,
  MaxLength,
  IsBoolean,
  IsInt,
  IsUUID,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PAYMENT_PROVIDERS } from '../../common/constants';

const BILLING_INTERVALS = ['month', 'year'] as const;
const PAYMENT_PROVIDER_VALUES = Object.values(PAYMENT_PROVIDERS);

export class CreatePlanDto {
  @ApiProperty({ example: 'pro' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 49900, description: 'Price in smallest currency unit' })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ example: 'USD', minLength: 3, maxLength: 3 })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({ example: 'month', enum: BILLING_INTERVALS })
  @IsOptional()
  @IsIn(BILLING_INTERVALS)
  interval?: (typeof BILLING_INTERVALS)[number] = 'month';

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalCount?: number = 1;

  @ApiPropertyOptional({ example: ['5 users', 'API access'], type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  features?: string[];
}

export class CreateSubscriptionDto {
  @ApiProperty({ example: 'tenant_acme_corp' })
  @IsString()
  tenantId!: string;

  @ApiProperty({ description: 'Plan UUID' })
  @IsUUID()
  planId!: string;

  @ApiProperty({ example: 'lenco', enum: PAYMENT_PROVIDER_VALUES })
  @IsIn(PAYMENT_PROVIDER_VALUES)
  paymentProvider!: (typeof PAYMENT_PROVIDER_VALUES)[number];

  @ApiPropertyOptional({ description: 'Provider-specific payment details (account number, card token, etc.)' })
  @IsOptional()
  @IsObject()
  paymentMetadata?: Record<string, any>;
}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ example: 'Switching to competitor' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({ description: 'If true, cancel at end of billing period; if false, cancel immediately' })
  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean = true;
}
