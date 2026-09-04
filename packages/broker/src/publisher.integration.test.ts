import { describe, expect, it } from 'vitest';
import { createPublisher } from './publisher.js';
import { createRedisClient } from './redis.js';

// Integration test: only runs when a real Redis is reachable (docker compose).
const redisUrl = process.env.REDIS_URL;

describe.runIf(Boolean(redisUrl))('publisher (integration)', () => {
  it('writes envelopes to the stream', async () => {
    const redis = createRedisClient(redisUrl);
    const stream = `test:broker:${Date.now()}`;
    try {
      const publisher = createPublisher(redis, { stream });
      await publisher.publishEvent('subscription.activated', { a: 1 }, 'evt_test_1');

      const range = await redis.xrange(stream, '-', '+');
      expect(range).toHaveLength(1);
      const [, fields] = range[0];
      const envelopeIndex = fields.findIndex((field) => field === 'envelope');
      expect(envelopeIndex).toBeGreaterThanOrEqual(0);
      const envelope = JSON.parse(fields[envelopeIndex + 1]);
      expect(envelope).toEqual({
        eventType: 'subscription.activated',
        payload: { a: 1 },
        idempotencyKey: 'evt_test_1',
      });
    } finally {
      await redis.del(stream);
      await redis.quit();
    }
  });
});
