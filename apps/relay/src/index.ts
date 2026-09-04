import { createServer } from 'node:http';
import { config as loadDotenv } from 'dotenv';
import { createPublisher, createRedisClient } from '@repo/broker';
import { closeDb, getDb } from '@repo/db';
import { createRelay } from './poller.js';

loadDotenv({ path: ['.env', '../../.env'] });

const db = getDb();
const redis = createRedisClient();
const publisher = createPublisher(redis);
const relay = createRelay(db, publisher);

const healthPort = Number(process.env.RELAY_HEALTH_PORT ?? 3002);
const health = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'relay' }));
    return;
  }
  res.writeHead(404);
  res.end();
});
health.listen(healthPort);

relay.start();
console.log(
  JSON.stringify({ level: 'info', event: 'relay.started', stream: publisher.stream, healthPort }),
);

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: 'info', event: 'relay.shutting_down', signal }));
  await relay.stop();
  health.close();
  await redis.quit().catch(() => redis.disconnect());
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
