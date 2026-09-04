import { config as loadDotenv } from 'dotenv';
import { serve as serveHttp } from '@hono/node-server';
import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { createConsumer, createRedisClient } from '@repo/broker';
import { functions, inngest } from '@repo/workflows';
import { bridgeEnvelopeToInngest } from './bridge.js';

loadDotenv({ path: ['.env', '../../.env'] });

const port = Number(process.env.WORKER_PORT ?? 3001);
const redis = createRedisClient();

// Redis Streams → Inngest bridge. Envelopes are validated by the consumer
// (invalid ones go to the dead-letter stream), and only acked after Inngest
// accepts the event.
const consumer = createConsumer(
  redis,
  {
    group: 'inngest-bridge',
    consumerName: `worker-${process.pid}`,
  },
  async (envelope) => {
    await bridgeEnvelopeToInngest(envelope);
  },
);

// Inngest executor endpoint: the Inngest dev server / cloud invokes this to
// drive the durable workflow functions.
const app = new Hono();
app.get('/health', (c) => c.json({ ok: true, service: 'worker' }));
app.all('/api/inngest', serve({ client: inngest, functions }));

await consumer.start();
const server = serveHttp({ fetch: app.fetch, port }, (info) => {
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'worker.started',
      port: info.port,
      inngestEndpoint: '/api/inngest',
    }),
  );
});

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: 'info', event: 'worker.shutting_down', signal }));
  await consumer.stop();
  server.close();
  await redis.quit().catch(() => redis.disconnect());
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
