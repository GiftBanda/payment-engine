import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Delete,
  Query,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsString, IsUrl, IsArray, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { Public } from '../common/decorators/public.decorator';

class RegisterWebhookDto {
  @ApiProperty({ example: 'tenant_acme' })
  @IsString()
  tenantId: string;

  @ApiProperty({ example: 'https://acme.com/api/webhooks' })
  @IsUrl()
  url: string;

  @ApiProperty({ example: ['payment.success', 'payment.failed'], description: 'Use ["*"] for all events' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];
}

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  // ─── Outbound webhook registration ────────────────────────────────────────

  @Post('subscriptions')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Register a webhook endpoint',
    description: 'Use events: ["*"] to receive all events, or specify individual ones.',
  })
  register(@Body() dto: RegisterWebhookDto) {
    return this.webhooksService.register(dto.tenantId, dto.url, dto.events);
  }

  @Get('subscriptions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List webhook subscriptions for a tenant' })
  list(@Query('tenantId') tenantId: string) {
    return this.webhooksService.listByTenant(tenantId);
  }

  @Delete('subscriptions/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a webhook subscription' })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooksService.deactivate(id);
  }

  @Get('deliveries')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get webhook delivery history for a resource' })
  getDeliveries(@Query('resourceId') resourceId: string) {
    return this.webhooksService.getDeliveries(resourceId);
  }

  // ─── Inbound: Lenco webhooks ───────────────────────────────────────────────

  @Post('inbound/lenco')
  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  async lencoWebhook(
    @Req() req: any,
    @Headers('x-lenco-signature') signature: string,
    @Body() body: any,
  ) {
    const rawBody: string = req.rawBody?.toString() ?? JSON.stringify(body);
    const isValid = this.webhooksService.verify(rawBody, signature ?? '');

    if (!isValid) {
      throw new BadRequestException('Invalid Lenco webhook signature');
    }

    const event = this.mapLencoEvent(body.event);
    if (event) {
      await this.webhooksService.enqueueDispatch(
        body.data?.reference,
        event,
        body.data ?? {},
      );
    }

    return { received: true };
  }

  // ─── Inbound: Stripe webhooks ─────────────────────────────────────────────

  @Post('inbound/stripe')
  @Public()
  @ApiExcludeEndpoint()
  @HttpCode(HttpStatus.OK)
  async stripeWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
    @Body() body: any,
  ) {
    // In production: use stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    const event = this.mapStripeEvent(body.type);
    if (event) {
      await this.webhooksService.enqueueDispatch(
        body.data?.object?.id,
        event,
        body.data?.object ?? {},
      );
    }

    return { received: true };
  }

  private mapLencoEvent(lencoEvent: string): string | null {
    const map: Record<string, string> = {
      'transfer.successful': 'payment.success',
      'transfer.failed': 'payment.failed',
      'transfer.pending': 'payment.pending',
    };
    return map[lencoEvent] ?? null;
  }

  private mapStripeEvent(stripeEvent: string): string | null {
    const map: Record<string, string> = {
      'payment_intent.succeeded': 'payment.success',
      'payment_intent.payment_failed': 'payment.failed',
      'charge.refunded': 'payment.refunded',
    };
    return map[stripeEvent] ?? null;
  }
}
