import { eq, isNull, outbox, type Database } from '@repo/db';
import type { EventPublisher } from '@repo/broker';

export interface RelayOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  log?: (line: string) => void;
}

export interface Relay {
  start(): void;
  /** Graceful stop: prevents new ticks and drains the in-flight batch. */
  stop(): Promise<void>;
  /** One poll cycle; returns the number of rows examined. Exposed for tests. */
  pollOnce(): Promise<number>;
}

/**
 * Outbox → Redis Streams relay (TRD §4E).
 *
 * Delivery semantics: publish-then-mark gives AT-LEAST-ONCE delivery. A
 * crash between publish and mark can duplicate a stream message; duplicates
 * are absorbed downstream via idempotency keys (BRD R2). A message can never
 * be lost. Running multiple relay instances is safe only with row claiming
 * (FOR UPDATE SKIP LOCKED) — kept out of this baseline; see docs.
 */
export function createRelay(
  db: Database,
  publisher: EventPublisher,
  options: RelayOptions = {},
): Relay {
  const batchSize = options.batchSize ?? 50;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const log = options.log ?? ((line: string) => console.log(line));

  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<number> | undefined;

  async function pollOnce(): Promise<number> {
    const rows = await db
      .select()
      .from(outbox)
      .where(isNull(outbox.processedAt))
      .orderBy(outbox.createdAt)
      .limit(batchSize);

    for (const row of rows) {
      try {
        await publisher.publishEvent(row.eventType, row.payload, row.idempotencyKey);
        await db
          .update(outbox)
          .set({ processedAt: new Date() })
          .where(eq(outbox.id, row.id));
      } catch (err) {
        // Leave the row unprocessed; the next tick retries it.
        log(
          JSON.stringify({
            level: 'error',
            event: 'relay.row_failed',
            outboxId: row.id,
            message: (err as Error).message,
          }),
        );
      }
    }

    if (rows.length > 0) {
      log(JSON.stringify({ level: 'info', event: 'relay.batch_published', count: rows.length }));
    }
    return rows.length;
  }

  async function tick(): Promise<void> {
    try {
      active = pollOnce();
      await active;
    } catch (err) {
      log(
        JSON.stringify({
          level: 'error',
          event: 'relay.poll_failed',
          message: (err as Error).message,
        }),
      );
    } finally {
      active = undefined;
      // Guard against overlapping ticks when a batch takes longer than the
      // poll interval.
      if (running) timer = setTimeout(() => void tick(), pollIntervalMs);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      void tick();
    },
    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
      if (active) await active;
    },
    pollOnce,
  };
}
