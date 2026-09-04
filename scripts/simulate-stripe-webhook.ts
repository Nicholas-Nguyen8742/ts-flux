/**
 * Simulates a signed Stripe webhook against the local API.
 *
 * Usage:
 *   pnpm simulate:webhook
 *   pnpm simulate:webhook -- --customer=cus_test_beta --plan=enterprise
 *   pnpm simulate:webhook -- --event-id=evt_replay_1   # replay = duplicate test
 *   pnpm simulate:webhook -- --status=past_due         # non-active transition
 */
import { createHmac, randomUUID } from 'node:crypto';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found?.slice(prefix.length);
}

const secret = process.env.STRIPE_WEBHOOK_SECRET ?? 'whsec_test_secret';
const apiUrl = arg('api') ?? process.env.API_URL ?? 'http://localhost:3000';
const eventId = arg('event-id') ?? `evt_${randomUUID()}`;
const customer = arg('customer') ?? 'cus_test_alpha';
const planTier = arg('plan') === 'enterprise' ? 'enterprise' : 'pro';
const eventType = arg('type') ?? 'customer.subscription.updated';
const status = arg('status') ?? 'active';

const payload = {
  id: eventId,
  type: eventType,
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: `sub_${customer}`, // deterministic per customer, like a real subscription id
      customer,
      status,
      metadata: { plan_tier: planTier },
    },
  },
};

const body = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

console.log(`POST ${apiUrl}/webhooks/stripe`);
console.log(`  event id : ${eventId}`);
console.log(`  type     : ${eventType} (status=${status}, plan=${planTier})`);
console.log(`  customer : ${customer}`);

const response = await fetch(`${apiUrl}/webhooks/stripe`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': `t=${timestamp},v1=${signature}`,
  },
  body,
});

console.log(`-> ${response.status} ${await response.text()}`);
