import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';

/**
 * Extracts the Idempotency-Key header from the request.
 *
 * Usage:
 *   @Post()
 *   create(@IdempotencyKey() key: string, @Body() dto: CreatePaymentDto) { ... }
 *
 * If required=true (default), throws 400 when the header is missing.
 */
export const IdempotencyKeyHeader = createParamDecorator(
  (required: boolean = true, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'] as string;

    if (required && !key) {
      throw new BadRequestException(
        'Missing required header: Idempotency-Key',
      );
    }

    return key;
  },
);
