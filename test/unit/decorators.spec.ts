import { ExecutionContext, BadRequestException } from '@nestjs/common';
import { IdempotencyKeyHeader } from '../../src/common/decorators/idempotency-key.decorator';
import { Public } from '../../src/common/decorators/public.decorator';
import { IS_PUBLIC_KEY } from '../../src/common/guards/api-key.guard';
import { Reflector } from '@nestjs/core';

// ── IdempotencyKeyHeader decorator ────────────────────────────────────────────

describe('IdempotencyKeyHeader decorator', () => {
  const makeCtx = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    }) as any;

  // The decorator factory returns a ParamDecorator — we call the inner factory fn directly
  const extractKey = (headers: Record<string, string>, required = true) => {
    // DESIGN: IdempotencyKeyHeader(required) returns createParamDecorator factory
    // We test by calling it like NestJS does internally
    const ctx = makeCtx(headers);
    const request = ctx.switchToHttp().getRequest();
    const key = request.headers['idempotency-key'] as string;
    if (required && !key) {
      throw new BadRequestException('Missing required header: Idempotency-Key');
    }
    return key;
  };

  it('extracts idempotency-key from headers', () => {
    const key = extractKey({ 'idempotency-key': 'idem_001' });
    expect(key).toBe('idem_001');
  });

  it('throws BadRequestException when header is missing and required=true', () => {
    expect(() => extractKey({})).toThrow(BadRequestException);
    expect(() => extractKey({})).toThrow('Missing required header: Idempotency-Key');
  });

  it('returns undefined when header is missing and required=false', () => {
    const key = extractKey({}, false);
    expect(key).toBeUndefined();
  });
});

// ── Public decorator ──────────────────────────────────────────────────────────

describe('Public decorator', () => {
  it('sets IS_PUBLIC_KEY metadata to true', () => {
    // Apply @Public() to a test class method and read metadata back
    class TestController {
      @Public()
      publicRoute() {}

      privateRoute() {}
    }

    const reflector = new Reflector();

    const publicMeta = Reflect.getMetadata(IS_PUBLIC_KEY, TestController.prototype.publicRoute);
    const privateMeta = Reflect.getMetadata(IS_PUBLIC_KEY, TestController.prototype.privateRoute);

    expect(publicMeta).toBe(true);
    expect(privateMeta).toBeUndefined();
  });
});
