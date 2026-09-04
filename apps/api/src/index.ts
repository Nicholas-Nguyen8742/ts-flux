import { config as loadDotenv } from 'dotenv';
import { serve } from '@hono/node-server';
import { closeDb } from '@repo/db';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

// Load app-local and workspace-root .env (turbo runs apps from their own dir).
loadDotenv({ path: ['.env', '../../.env'] });

const appConfig = loadConfig();
const app = createApp(appConfig.stripeWebhookSecret);

const server = serve({ fetch: app.fetch, port: appConfig.port }, (info) => {
  console.log(JSON.stringify({ level: 'info', event: 'api.listening', port: info.port }));
});

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: 'info', event: 'api.shutting_down', signal }));
  server.close();
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
