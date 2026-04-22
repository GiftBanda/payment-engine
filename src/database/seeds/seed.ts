import { AppDataSource } from '../data-source';
import { Plan } from '../../billing/entities/plan.entity';
import { WebhookSubscription } from '../../webhooks/entities/webhook-subscription.entity';
import * as crypto from 'crypto';

const PLANS = [
  {
    name: 'starter',
    price: 1990,       // $19.90
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
    features: ['5 users', 'Basic analytics', 'Email support', '1 webhook endpoint'],
    isActive: true,
  },
  {
    name: 'pro',
    price: 4990,       // $49.90
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
    features: ['25 users', 'Advanced analytics', 'Priority support', 'API access', '5 webhook endpoints'],
    isActive: true,
  },
  {
    name: 'business',
    price: 9990,       // $99.90
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
    features: ['100 users', 'Full analytics', '24/7 support', 'API access', 'SLA 99.9%', 'Unlimited webhooks'],
    isActive: true,
  },
  {
    name: 'enterprise',
    price: 14990,      // $149.90
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
    features: ['Unlimited users', 'Custom analytics', 'Dedicated support', 'Full API', 'Custom SLA', 'Unlimited webhooks', 'Custom integrations'],
    isActive: true,
  },
];

const DEMO_TENANT = 'tenant_demo_001';

async function seed() {
  console.log('🌱 Connecting to database...');

  await AppDataSource.initialize();
  console.log('✅ Connected.\n');

  // ── Plans ──────────────────────────────────────────────────────────────────
  console.log('📦 Seeding plans...');
  const planRepo = AppDataSource.getRepository(Plan);

  for (const planData of PLANS) {
    const exists = await planRepo.findOne({ where: { name: planData.name } });
    if (exists) {
      console.log(`  ⤷ [skip] Plan "${planData.name}" already exists`);
      continue;
    }
    const plan = planRepo.create(planData);
    await planRepo.save(plan);
    console.log(`  ✓ Created plan: ${planData.name} @ $${(planData.price / 100).toFixed(2)}/mo`);
  }

  // ── Demo webhook subscription ──────────────────────────────────────────────
  console.log('\n🔗 Seeding demo webhook subscription...');
  const webhookRepo = AppDataSource.getRepository(WebhookSubscription);

  const existingWebhook = await webhookRepo.findOne({ where: { tenantId: DEMO_TENANT } });
  if (existingWebhook) {
    console.log(`  ⤷ [skip] Webhook for ${DEMO_TENANT} already exists`);
  } else {
    const secret = crypto.randomBytes(32).toString('hex');
    const webhook = webhookRepo.create({
      tenantId: DEMO_TENANT,
      url: 'https://webhook.site/demo-endpoint',
      events: ['*'],  // receive all events
      secret,
      isActive: true,
    });
    await webhookRepo.save(webhook);
    console.log(`  ✓ Created webhook for ${DEMO_TENANT}`);
    console.log(`  ℹ  Signing secret: ${secret}`);
  }

  console.log('\n🎉 Seeding complete.\n');
  await AppDataSource.destroy();
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
