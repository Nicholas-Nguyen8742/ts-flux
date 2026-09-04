import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal typed view of a Stripe event — we only consume the fields the
 * webhook flow needs, and validate them with Zod downstream.
 */
export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
}

export class StripeSignatureError extends Error {}

export interface VerifyOptions {
  /** Max age of the webhook timestamp in seconds. */
  toleranceSeconds?: number;
  /** Injectable clock (milliseconds), for tests. */
  now?: () => number;
}

/**
 * Verifies a `stripe-signature` header against the raw request body.
 *
 * Stripe signs `${timestamp}.${rawBody}` with HMAC-SHA256 using the webhook
 * endpoint secret; the header looks like `t=1614556828,v1=5257a86...,v1=...`.
 * We accept the event if ANY v1 signature matches, mirroring stripe-node's
 * behavior, and reject timestamps outside the tolerance window to block
 * replay of old (validly signed) payloads.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  options: VerifyOptions = {},
): StripeEvent {
  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((options.now ?? Date.now)() / 1000);

  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') signatures.push(value);
  }

  if (timestamp === null || !Number.isFinite(timestamp)) {
    throw new StripeSignatureError('missing or invalid timestamp');
  }
  if (signatures.length === 0) {
    throw new StripeSignatureError('missing v1 signature');
  }
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new StripeSignatureError('timestamp outside tolerance window');
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest();
  const verified = signatures.some((signature) => {
    const actual = Buffer.from(signature, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!verified) {
    throw new StripeSignatureError('signature mismatch');
  }

  try {
    return JSON.parse(rawBody) as StripeEvent;
  } catch {
    throw new StripeSignatureError('invalid JSON payload');
  }
}
