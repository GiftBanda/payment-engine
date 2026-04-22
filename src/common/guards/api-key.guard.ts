import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Simple API-key guard.
 *
 * Checks the Authorization header for: Bearer <APP_SECRET>
 *
 * Mark routes public with @Public() to bypass this guard.
 * In production, replace with JWT or OAuth2 — the guard contract stays the same.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly appSecret: string;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.appSecret = config.get<string>('appSecret') ?? '';
  }

  canActivate(context: ExecutionContext): boolean {
    // Allow public routes (e.g. /health, /docs, inbound webhooks)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string = request.headers['authorization'] ?? '';

    if (!authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Authorization header');
    }

    const token = authHeader.slice(7);

    if (!this.appSecret || token !== this.appSecret) {
      throw new UnauthorizedException('Invalid API key');
    }

    return true;
  }
}
