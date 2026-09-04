import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseEnvelope } from './registry.js';

const tenantId = randomUUID();

const validEnvelope = {
  eventType: 'subscription.activated',
  payload: {
    tenantId,
    stripeSubscriptionId: 'sub_test_001',
    planTier: 'pro',
  },
  idempotencyKey: 'evt_test_001',
};

describe('parseEnvelope', () => {
  it('parses a valid envelope with a typed payload', () => {
    const event = parseEnvelope(validEnvelope);
    expect(event.eventType).toBe('subscription.activated');
    expect(event.idempotencyKey).toBe('evt_test_001');
    if (event.eventType === 'subscription.activated') {
      expect(event.payload.tenantId).toBe(tenantId);
      expect(event.payload.planTier).toBe('pro');
    }
  });

  it('rejects unknown event types', () => {
    expect(() =>
      parseEnvelope({ ...validEnvelope, eventType: 'billing.refunded' }),
    ).toThrow(/Unknown event type/);
  });

  it('rejects payloads that fail schema validation', () => {
    expect(() =>
      parseEnvelope({
        ...validEnvelope,
        payload: { ...validEnvelope.payload, planTier: 'free' },
      }),
    ).toThrow();
  });

  it('rejects envelopes missing an idempotency key', () => {
    const { idempotencyKey: _omitted, ...rest } = validEnvelope;
    expect(() => parseEnvelope(rest)).toThrow();
  });

  it('rejects non-object input', () => {
    expect(() => parseEnvelope('nonsense')).toThrow();
  });
});
