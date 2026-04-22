import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { CreatePlanDto, CreateSubscriptionDto, CancelSubscriptionDto } from './dto/billing.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  // ─── Plans ──────────────────────────────────────────────────────────────

  @Post('plans')
  @ApiOperation({ summary: 'Create a billing plan' })
  createPlan(@Body() dto: CreatePlanDto) {
    return this.billingService.createPlan(dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'List all active billing plans' })
  listPlans() {
    return this.billingService.listPlans();
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get a plan by ID' })
  findPlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.findPlan(id);
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────

  @Post('subscriptions')
  @ApiOperation({
    summary: 'Create a subscription',
    description: 'Creates a subscription and immediately triggers the first charge.',
  })
  createSubscription(@Body() dto: CreateSubscriptionDto) {
    return this.billingService.createSubscription(dto);
  }

  @Get('subscriptions/:id')
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Get subscription by ID' })
  findSubscription(@Param('id', ParseUUIDPipe) id: string) {
    return this.billingService.findSubscription(id);
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'List all subscriptions for a tenant' })
  listByTenant(@Query('tenantId') tenantId: string) {
    return this.billingService.listByTenant(tenantId);
  }

  @Post('subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiOperation({ summary: 'Cancel a subscription (immediate or at period end)' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSubscriptionDto,
  ) {
    return this.billingService.cancelSubscription(id, dto);
  }
}
