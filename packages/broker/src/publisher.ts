import type { Redis } from 'ioredis';

/**
 * Single stream carries every event type; `eventType` travels inside the
 * envelope. This keeps relay and consumer trivially simple; per-type streams
 * remain a future optimization.
 */
export const DEFAULT_STREAM = 'tsflux:events';
export const DEFAULT_MAX_LEN = 10_000;

export interface PublisherOptions {
  stream?: string;
  /** Approximate stream trim cap (XADD MAXLEN ~). */
  maxLen?: number;
}

export interface EventPublisher {
  readonly stream: string;
  /** Returns the Redis stream message id. */
  publishEvent(eventType: string, payload: unknown, idempotencyKey: string): Promise<string>;
}

export function createPublisher(redis: Redis, options: PublisherOptions = {}): EventPublisher {
  const stream = options.stream ?? DEFAULT_STREAM;
  const maxLen = options.maxLen ?? DEFAULT_MAX_LEN;

  return {
    stream,
    async publishEvent(eventType, payload, idempotencyKey) {
      const envelope = JSON.stringify({ eventType, payload, idempotencyKey });
      const id = await redis.xadd(
        stream,
        'MAXLEN',
        '~',
        String(maxLen),
        '*',
        'envelope',
        envelope,
      );
      if (!id) throw new Error(`XADD to ${stream} returned no message id`);
      return id;
    },
  };
}
