export const QUEUES = {
  PAYMENTS: 'payments',
  WEBHOOKS: 'webhooks',
  BILLING: 'billing',
} as const;

export const PAYMENT_JOBS = {
  PROCESS_CHARGE: 'process_charge',
  RETRY_CHARGE: 'retry_charge',
} as const;

export const WEBHOOK_JOBS = {
  DISPATCH: 'dispatch_webhook',
} as const;

export const BILLING_JOBS = {
  RENEW_SUBSCRIPTION: 'renew_subscription',
  SEND_INVOICE: 'send_invoice',
} as const;

export const PAYMENT_PROVIDERS = {
  LENCO: 'lenco',
  STRIPE: 'stripe',
} as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[keyof typeof PAYMENT_PROVIDERS];

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  TRIALING: 'trialing',
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const WEBHOOK_STATUS = {
  PENDING: 'pending',
  DELIVERED: 'delivered',
  FAILED: 'failed',
} as const;

export const IDEMPOTENCY_STATUS = {
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
