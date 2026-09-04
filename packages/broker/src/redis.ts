import { Redis } from 'ioredis';

/**
 * Shared Redis client factory. Callers own the returned client and are
 * responsible for closing it.
 */
export function createRedisClient(url: string | undefined = process.env.REDIS_URL): Redis {
  if (!url) throw new Error('REDIS_URL is not set');
  return new Redis(url);
}
