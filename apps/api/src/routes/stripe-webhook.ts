import { Hono } from 'hono';
import { z } from 'zod';
import {
  eq,
  getDb,
  outbox,
  subscriptions,
  tenants,
  withTransaction,
} from '@repo/db';
import {
  subscriptionActivatedSchema,
  subscriptionCancelledSchema,
  subscriptionUpdatedSchema,
} from '@repo/events';
import {
  StripeSignatureError,
  verifyStripeSignature,
  type StripeEvent,
} from '../stripe/signature.js';

/** The subset of a Stripe subscription object this service consumes. */
const stripeSubscriptionSchema = z.object({
  id: z.string().min(1),
  customer: z.union([z.string(), z.object({ id: z.string() })]),
  status: z.string().min(1),
  metadata: z.record(z.string(), z.string()).optional(),
});
type StripeSubscription = z.infer<typeof stripeSubscriptionSchema>;

function planTierFrom(subscription: StripeSubscription): 'pro' | 'enterprise' {
  return subscription.metadata?.plan_tier === 'enterprise' ? 'enterprise' : 'pro';
}

/**
 * BRD R1: Stripe is the source of truth. Active subscriptions mirror the
 * plan tier; every other Stripe status is copied verbatim.
 */
function tenantStatusFor(subscriptionStatus: string, planTier: string): string {
  if (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') {
    return planTier;
  }
  return subscriptionStatus;
}

export function createStripeWebhookRouter(webhookSecret: string): Hono {
  const app = new Hono();

  app.post('/webhooks/stripe', async (c) => {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header('stripe-signature');
    if (!signatureHeader) {
      return c.json({ error: 'missing stripe-signature header' }, 400);
    }

    let event: StripeEvent;
    try {
      event = verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
    } catch (err) {
      if (err instanceof StripeSignatureError) {
        return c.json({ error: `invalid signature: ${err.message}` }, 400);
      }
      throw err;
    }

    if (
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      await handleSubscriptionEvent(event);
    }
    // Unknown event types are acked: Stripe must not retry them forever.
    return c.json({ received: true });
  });

  return app;
}

async function handleSubscriptionEvent(event: StripeEvent): Promise<void> {
  const parsed = stripeSubscriptionSchema.safeParse(event.data.object);
  if (!parsed.success) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'webhook.payload_invalid',
        stripeEventId: event.id,
        issues: parsed.error.issues,
      }),
    );
    return;
  }
  const subscription = parsed.data;
  const stripeCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  // Resolve the tenant from Stripe's customer id (TRD sample conflated
  // tenantId with stripeCustomerId — fixed here).
  const db = getDb();
  const tenant = await db.query.tenants.findOne({
    where: eq(tenants.stripeCustomerId, stripeCustomerId),
  });
  if (!tenant) {
    // Ack unknown customers to avoid Stripe retry storms; log for audit.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'webhook.unknown_customer',
        stripeCustomerId,
        stripeEventId: event.id,
      }),
    );
    return;
  }

  const planTier = planTierFrom(subscription);
  const cancelled =
    event.type === 'customer.subscription.deleted' || subscription.status === 'canceled';

  const { eventType, payload } = cancelled
    ? {
        eventType: 'subscription.cancelled',
        payload: subscriptionCancelledSchema.parse({
          tenantId: tenant.id,
          stripeSubscriptionId: subscription.id,
        }),
      }
    : subscription.status === 'active' || subscription.status === 'trialing'
      ? {
          eventType: 'subscription.activated',
          payload: subscriptionActivatedSchema.parse({
            tenantId: tenant.id,
            stripeSubscriptionId: subscription.id,
            planTier,
          }),
        }
      : {
          eventType: 'subscription.updated',
          payload: subscriptionUpdatedSchema.parse({
            tenantId: tenant.id,
            stripeSubscriptionId: subscription.id,
            planTier,
            status: subscription.status,
          }),
        };

  // ATOMIC OUTBOX WRITE (BRD R3): business state and the outbox event commit
  // or roll back together. The Stripe event id is the idempotency key (BRD R2).
  try {
    await withTransaction(async (tx) => {
      await tx
        .update(tenants)
        .set({
          status: tenantStatusFor(cancelled ? 'canceled' : subscription.status, planTier),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.id));

      await tx
        .insert(subscriptions)
        .values({
          tenantId: tenant.id,
          stripeSubscriptionId: subscription.id,
          status: cancelled ? 'canceled' : subscription.status,
          planTier,
        })
        .onConflictDoUpdate({
          target: subscriptions.stripeSubscriptionId,
          set: {
            status: cancelled ? 'canceled' : subscription.status,
            planTier,
            updatedAt: new Date(),
          },
        });

      await tx.insert(outbox).values({
        eventType,
        payload,
        idempotencyKey: event.id,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicate webhook: the outbox row was already written by a previous
      // delivery of this Stripe event. Ack and move on (BRD R2).
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'webhook.duplicate_ignored',
          stripeEventId: event.id,
        }),
      );
      return;
    }
    throw err;
  }
}

/**
 * Postgres error code 23505 (unique_violation). The only unique constraint
 * reachable inside the transaction above — besides upsert-handled ones — is
 * `outbox.idempotency_key`, so a violation means "duplicate webhook".
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
