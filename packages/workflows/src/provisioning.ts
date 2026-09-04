import { getDb, infrastructureResources } from '@repo/db';
import { createIdempotencyStore, type IdempotencyStore } from '@repo/idempotency';
import { Redis } from 'ioredis';
import { inngest } from './client.js';
import { callProvisioningAPI, createLoggingEmailProvider } from './activities.js';
import { provisioningEventDataSchema } from './types.js';

let idempotencyStore: IdempotencyStore | undefined;
function getIdempotencyStore(): IdempotencyStore {
  if (!idempotencyStore) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL is not set');
    idempotencyStore = createIdempotencyStore(new Redis(redisUrl));
  }
  return idempotencyStore;
}

const email = createLoggingEmailProvider();

/**
 * Durable provisioning workflow (TRD §4F). Inngest persists each step's
 * result, so retries after a crash never re-run completed steps.
 */
export const provisionSubscription = inngest.createFunction(
  { id: 'provision-subscription', retries: 5 },
  { event: 'app/subscription.activated' },
  async ({ event, step }) => {
    // Validate at the boundary: bad payloads should fail fast, not retry.
    const data = provisioningEventDataSchema.parse(event.data);
    const { tenantId, stripeSubscriptionId, planTier, idempotencyKey } = data;

    // Step 1: idempotency check (durable). The lock is a "processed" marker
    // held until TTL: redelivered events skip. It is intentionally NOT
    // released after success (BRD R2).
    const lockAcquired = await step.run('check-idempotency', async () =>
      getIdempotencyStore().acquireLock(idempotencyKey),
    );
    if (!lockAcquired) {
      return { status: 'skipped', reason: 'already_processed' } as const;
    }

    // Step 2: provision infrastructure. Inngest auto-retries this step on
    // transient failure; step memoization guarantees at-most-once execution
    // per workflow run.
    const resources = await step.run('provision-infra', async () =>
      callProvisioningAPI(tenantId, planTier, idempotencyKey),
    );

    // Step 3: record provisioned resources. The unique idempotency key makes
    // replayed writes no-ops instead of duplicates.
    const recorded = await step.run('record-resources', async () => {
      const db = getDb();
      return db
        .insert(infrastructureResources)
        .values(
          resources.map((resource) => ({
            tenantId,
            kind: resource.kind,
            externalRef: resource.externalRef,
            status: 'active',
            idempotencyKey: `${idempotencyKey}:${resource.kind}`,
          })),
        )
        .onConflictDoNothing({ target: infrastructureResources.idempotencyKey })
        .returning();
    });

    // Step 4: notify the customer (durable).
    await step.run('send-email', async () => {
      await email.send({
        to: tenantId,
        subject: `Your ${planTier} workspace is ready`,
        body: `Subscription ${stripeSubscriptionId} has been provisioned.`,
      });
    });

    return { status: 'success', resourceIds: recorded.map((row) => row.id) } as const;
  },
);

export const functions = [provisionSubscription];
