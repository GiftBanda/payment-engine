import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, PaymentFilterDto, RefundPaymentDto } from './dto/payment.dto';

@ApiTags('Payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Initiate a payment',
    description: 'Creates a payment and enqueues it for processing. Safe to retry with the same idempotencyKey.',
  })
  @ApiResponse({ status: 201, description: 'Payment created and queued.' })
  @ApiResponse({ status: 409, description: 'Duplicate request — idempotency key in-flight.' })
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List payments with filters and pagination' })
  findAll(@Query() filter: PaymentFilterDto) {
    return this.paymentsService.findAll(filter);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single payment by ID' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.findOne(id);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refund a payment (full or partial)' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.paymentsService.refund(id, dto);
  }

  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sync payment status from provider',
    description: 'Polls the provider for the latest status (useful for pending Lenco transfers).',
  })
  syncStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.syncStatus(id);
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Get full transaction audit log for a payment' })
  getLogs(@Param('id', ParseUUIDPipe) id: string) {
    return this.paymentsService.getLogs(id);
  }
}
