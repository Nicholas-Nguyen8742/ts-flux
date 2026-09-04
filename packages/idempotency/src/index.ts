import type { Redis } from 'ioredis';

export const DEFAULT_KEY_PREFIX = 'idempotency:';
export const DEFAULT_TTL_SECONDS = 3600;

export interface IdempotencyStore {
  /**
   * Atomically marks `key` as processed. Returns `true` only for the first
   * caller within the TTL window.
   */
  acquireLock(key: string, ttlSeconds?: number): Promise<boolean>;
  /**
   * Removes the processed marker. See the semantics note in the README:
   * this is only safe BEFORE any side effect has happened.
   */
  releaseLock(key: string): Promise<void>;
}

export interface IdempotencyStoreOptions {
  keyPrefix?: string;
  defaultTtlSeconds?: number;
}

/**
 * Redis-backed idempotency checker. The Redis client is injected so callers
 * own its lifecycle (and tests can inject fakes).
 *
 * Semantics (BRD R2): a held lock IS the "already processed" marker. It is
 * intentionally held until TTL expiry after successful processing so that
 * redelivered events (at-least-once relay, webhook replays) are skipped.
 * Never release a lock after side effects succeeded.
 */
export function createIdempotencyStore(
  redis: Redis,
  options: IdempotencyStoreOptions = {},
): IdempotencyStore {
  const keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const defaultTtlSeconds = options.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
  const fullKey = (key: string) => `${keyPrefix}${key}`;

  return {
    async acquireLock(key, ttlSeconds = defaultTtlSeconds) {
      // SET NX EX: set if Not eXists, with EXpiration. Atomic check-and-set.
      const result = await redis.set(fullKey(key), '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    },
    async releaseLock(key) {
      await redis.del(fullKey(key));
    },
  };
}
