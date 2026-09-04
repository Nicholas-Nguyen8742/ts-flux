import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEY_PREFIX, createIdempotencyStore } from './index.js';

/** Minimal in-memory fake implementing only the Redis surface we use. */
class FakeRedis {
  store = new Map<string, string>();

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    let nx = false;
    for (let i = 0; i < args.length; i += 1) {
      if (String(args[i]).toUpperCase() === 'NX') nx = true;
    }
    if (nx && this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }
}

const asRedis = (fake: FakeRedis) => fake as unknown as Redis;

describe('createIdempotencyStore', () => {
  it('grants the lock to the first caller only', async () => {
    const store = createIdempotencyStore(asRedis(new FakeRedis()));
    expect(await store.acquireLock('evt_1')).toBe(true);
    expect(await store.acquireLock('evt_1')).toBe(false);
  });

  it('keeps distinct keys independent', async () => {
    const store = createIdempotencyStore(asRedis(new FakeRedis()));
    expect(await store.acquireLock('evt_1')).toBe(true);
    expect(await store.acquireLock('evt_2')).toBe(true);
  });

  it('allows re-acquire after release (pre-side-effect failure path)', async () => {
    const store = createIdempotencyStore(asRedis(new FakeRedis()));
    expect(await store.acquireLock('evt_1')).toBe(true);
    await store.releaseLock('evt_1');
    expect(await store.acquireLock('evt_1')).toBe(true);
  });

  it('namespaces keys with the configured prefix', async () => {
    const fake = new FakeRedis();
    const store = createIdempotencyStore(asRedis(fake), { keyPrefix: 'custom:' });
    await store.acquireLock('evt_1');
    expect(fake.store.has('custom:evt_1')).toBe(true);
    expect(fake.store.has(`${DEFAULT_KEY_PREFIX}evt_1`)).toBe(false);
  });
});
