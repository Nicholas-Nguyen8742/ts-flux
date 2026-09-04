import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getDb, closeDb } from './client.js';
import { outbox } from './schema.js';
import { withTransaction } from './transaction.js';
import { eq } from 'drizzle-orm';

// Integration test: only runs when a real Postgres is reachable (docker compose).
const databaseUrl = process.env.DATABASE_URL;

describe.runIf(Boolean(databaseUrl))('withTransaction (integration)', () => {
  it('rolls back all writes when the callback throws (BRD R3)', async () => {
    const db = getDb();
    const idempotencyKey = `test_${randomUUID()}`;
    try {
      await withTransaction(async (tx) => {
        await tx.insert(outbox).values({
          eventType: 'subscription.activated',
          payload: { test: true },
          idempotencyKey,
        });
        throw new Error('forced failure');
      });
    } catch {
      // expected
    }
    const rows = await db.select().from(outbox).where(eq(outbox.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(0);
    await closeDb();
  });

  it('commits atomically on success', async () => {
    const db = getDb();
    const idempotencyKey = `test_${randomUUID()}`;
    await withTransaction(async (tx) => {
      await tx.insert(outbox).values({
        eventType: 'subscription.activated',
        payload: { test: true },
        idempotencyKey,
      });
    });
    const rows = await db.select().from(outbox).where(eq(outbox.idempotencyKey, idempotencyKey));
    expect(rows).toHaveLength(1);
    await db.delete(outbox).where(eq(outbox.idempotencyKey, idempotencyKey));
    await closeDb();
  });

  it('enforces outbox idempotency key uniqueness (BRD R2)', async () => {
    const db = getDb();
    const idempotencyKey = `test_${randomUUID()}`;
    await db.insert(outbox).values({
      eventType: 'subscription.activated',
      payload: { test: true },
      idempotencyKey,
    });
    await expect(
      db.insert(outbox).values({
        eventType: 'subscription.activated',
        payload: { test: true },
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: '23505' });
    await db.delete(outbox).where(eq(outbox.idempotencyKey, idempotencyKey));
    await closeDb();
  });
});
