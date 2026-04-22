import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });
  const config = app.get(ConfigService);
  const port = config.get<number>('port') ?? 3000;
  const nodeEnv = config.get<string>('nodeEnv') ?? 'development';
  const docsEnabled = config.get<boolean>('http.enableDocs', false);
  const trustProxy = config.get<boolean>('http.trustProxy', false);
  const corsOrigins = config.get<string[]>('http.corsOrigins') ?? [];

  app.enableShutdownHooks();

  if (trustProxy) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: docsEnabled ? false : undefined,
    }),
  );

  // Global exception filter — structured JSON errors
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global request/response logger
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Validation pipe — strips unknown fields, auto-casts types
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (docsEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Payment & Billing Engine')
      .setDescription(
        [
          'Payment orchestration API - Lenco + Stripe, subscription billing,',
          'idempotent payments, HMAC-signed webhook delivery, full audit logging.',
          '',
          '**Idempotency:** Pass a unique `idempotencyKey` on every POST /payments.',
          'Retrying with the same key replays the cached result - no double charges.',
        ].join('\n'),
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Health', 'Service health and queue stats')
      .addTag('Payments', 'Initiate, track, refund payments')
      .addTag('Billing', 'Subscription plans and lifecycle management')
      .addTag('Webhooks', 'Register endpoints and view delivery logs')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
      customSiteTitle: 'Payment Engine Docs',
    });
  }

  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : nodeEnv !== 'production',
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Requested-With'],
  });

  await app.listen(port, '0.0.0.0');

  logger.log(`Server listening on port ${port} (${nodeEnv})`);
  if (docsEnabled) {
    logger.log(`Swagger available at /docs`);
  }
  logger.log('Health endpoint available at /health');
}

bootstrap();
