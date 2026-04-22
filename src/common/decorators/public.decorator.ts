import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../guards/api-key.guard';

/**
 * Mark a controller or route as public — bypasses ApiKeyGuard.
 *
 * Usage:
 *   @Public()
 *   @Get('health')
 *   check() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
