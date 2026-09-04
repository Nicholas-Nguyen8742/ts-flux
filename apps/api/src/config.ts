export interface ApiConfig {
  port: number;
  stripeWebhookSecret: string;
}

export function loadConfig(): ApiConfig {
  const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeWebhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  }
  return {
    port: Number(process.env.PORT ?? 3000),
    stripeWebhookSecret,
  };
}
