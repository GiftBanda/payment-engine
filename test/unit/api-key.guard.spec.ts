import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from '../../src/common/guards/api-key.guard';

const makeContext = (authHeader?: string, isPublic = false): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({
      headers: authHeader ? { authorization: authHeader } : {},
    }),
  }),
  getHandler: () => ({}),
  getClass: () => ({}),
} as any);

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('super-secret-key') } },
        { provide: Reflector, useValue: { getAllAndOverride: jest.fn().mockReturnValue(false) } },
      ],
    }).compile();

    guard = module.get(ApiKeyGuard);
    reflector = module.get(Reflector);
  });

  it('allows requests with valid Bearer token', () => {
    const ctx = makeContext('Bearer super-secret-key');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('throws UnauthorizedException for wrong token', () => {
    const ctx = makeContext('Bearer wrong-key');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when Authorization header is missing', () => {
    const ctx = makeContext();
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when not using Bearer scheme', () => {
    const ctx = makeContext('Basic super-secret-key');
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('allows public routes without any auth header', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext(); // no auth header
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows public routes even with wrong token', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext('Bearer totally-wrong');
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
