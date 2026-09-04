import { Hono } from 'hono';
import { createStripeWebhookRouter } from './routes/stripe-webhook.js';

export function createApp(stripeWebhookSecret: string): Hono {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: 'api' }));
  app.route('/', createStripeWebhookRouter(stripeWebhookSecret));

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((err, c) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'api.unhandled_error',
        message: err.message,
        stack: err.stack,
      }),
    );
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
