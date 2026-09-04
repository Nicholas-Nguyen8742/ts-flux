import type { Redis } from 'ioredis';
import { parseEnvelope, type EventEnvelope } from '@repo/events';
import { DEFAULT_STREAM } from './publisher.js';

export const DEFAULT_DEAD_LETTER_STREAM = 'tsflux:events:dlq';

export interface ConsumerOptions {
  stream?: string;
  group: string;
  consumerName: string;
  /** Max messages per XREADGROUP batch. */
  count?: number;
  /** XREADGROUP BLOCK window. Also bounds stop() latency. */
  blockMs?: number;
  /** How often to run the pending-message sweep. */
  reclaimIntervalMs?: number;
  /** Idle time after which a pending message is claimed from its consumer. */
  idleClaimMs?: number;
  /** Deliveries after which a message is dead-lettered. */
  maxDeliveries?: number;
  deadLetterStream?: string;
}

export type MessageHandler = (envelope: EventEnvelope, messageId: string) => Promise<void>;

export interface EventConsumer {
  start(): Promise<void>;
  /** Graceful stop: waits for the in-flight batch and the BLOCK window. */
  stop(): Promise<void>;
}

type StreamMessage = [id: string, fields: string[]];

const log = (record: Record<string, unknown>) =>
  console.log(JSON.stringify({ service: 'broker-consumer', ...record }));

function extractEnvelopeField(fields: string[]): string | undefined {
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === 'envelope') return fields[i + 1];
  }
  return undefined;
}

/**
 * Consumer-group based Redis Streams consumer with at-least-once delivery:
 *
 * - A message is XACKed only after the handler succeeds.
 * - Handler failure leaves the message pending; a periodic sweep claims
 *   messages idle longer than `idleClaimMs` (covers crashed consumers).
 * - Messages that exceed `maxDeliveries` are moved to a dead-letter stream
 *   and acked, so one poison message cannot wedge the group.
 * - Unparseable envelopes are dead-lettered immediately (they can never
 *   succeed on retry).
 */
export function createConsumer(
  redis: Redis,
  options: ConsumerOptions,
  handler: MessageHandler,
): EventConsumer {
  const stream = options.stream ?? DEFAULT_STREAM;
  const { group, consumerName } = options;
  const count = options.count ?? 10;
  const blockMs = options.blockMs ?? 2000;
  const reclaimIntervalMs = options.reclaimIntervalMs ?? 10_000;
  const idleClaimMs = options.idleClaimMs ?? 30_000;
  const maxDeliveries = options.maxDeliveries ?? 5;
  const deadLetterStream = options.deadLetterStream ?? DEFAULT_DEAD_LETTER_STREAM;

  let running = false;
  let loopPromise: Promise<void> | null = null;
  let lastReclaimAt = 0;

  async function ensureGroup(): Promise<void> {
    try {
      // Start at '0' (not '$') so messages published before the group
      // existed are not silently dropped.
      await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch (err) {
      if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
    }
  }

  async function deadLetter(messageId: string, rawEnvelope: string, reason: string): Promise<void> {
    await redis.xadd(
      deadLetterStream,
      '*',
      'originalStream',
      stream,
      'originalId',
      messageId,
      'reason',
      reason,
      'envelope',
      rawEnvelope,
      'deadLetAt',
      new Date().toISOString(),
    );
    log({ level: 'warn', event: 'consumer.dead_letter', messageId, reason });
  }

  async function processMessages(messages: StreamMessage[]): Promise<void> {
    for (const [messageId, fields] of messages) {
      const raw = extractEnvelopeField(fields) ?? '';
      let envelope: EventEnvelope;
      try {
        envelope = parseEnvelope(raw ? JSON.parse(raw) : null);
      } catch (err) {
        await deadLetter(messageId, raw, `invalid envelope: ${(err as Error).message}`);
        await redis.xack(stream, group, messageId);
        continue;
      }
      try {
        await handler(envelope, messageId);
        await redis.xack(stream, group, messageId);
      } catch (err) {
        // Leave unacked: the reclaim sweep retries it and dead-letters it
        // after maxDeliveries. Idempotency keys absorb duplicate effects.
        log({
          level: 'error',
          event: 'consumer.handler_failed',
          messageId,
          message: (err as Error).message,
        });
      }
    }
  }

  async function reclaimSweep(): Promise<void> {
    const pending = (await redis.xpending(stream, group, '-', '+', 100)) as unknown as
      | Array<[id: string, consumer: string, idleMs: number, deliveries: number]>
      | null;
    if (!pending || pending.length === 0) return;

    const claimable: string[] = [];
    for (const [id, , idleMs, deliveries] of pending) {
      if (deliveries >= maxDeliveries) {
        const range = (await redis.xrange(stream, id, id)) as unknown as StreamMessage[];
        const fields = range[0]?.[1] ?? [];
        await deadLetter(id, extractEnvelopeField(fields) ?? '', `exceeded max deliveries (${deliveries})`);
        await redis.xack(stream, group, id);
      } else if (idleMs >= idleClaimMs) {
        claimable.push(id);
      }
    }

    if (claimable.length > 0) {
      const claimed = (await redis.xclaim(
        stream,
        group,
        consumerName,
        idleClaimMs,
        ...claimable,
      )) as unknown as StreamMessage[];
      await processMessages(claimed);
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      const now = Date.now();
      if (now - lastReclaimAt >= reclaimIntervalMs) {
        lastReclaimAt = now;
        try {
          await reclaimSweep();
        } catch (err) {
          log({ level: 'error', event: 'consumer.reclaim_failed', message: (err as Error).message });
        }
      }
      try {
        const response = (await redis.xreadgroup(
          'GROUP',
          group,
          consumerName,
          'COUNT',
          count,
          'BLOCK',
          blockMs,
          'STREAMS',
          stream,
          '>',
        )) as unknown as Array<[stream: string, messages: StreamMessage[]]> | null;
        if (response) {
          for (const [, messages] of response) {
            await processMessages(messages);
          }
        }
      } catch (err) {
        if (!running) break;
        log({ level: 'error', event: 'consumer.read_failed', message: (err as Error).message });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  return {
    async start() {
      if (running) return;
      await ensureGroup();
      running = true;
      lastReclaimAt = 0;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      // Waits at most one BLOCK window for the in-flight read to return.
      if (loopPromise) await loopPromise;
    },
  };
}
