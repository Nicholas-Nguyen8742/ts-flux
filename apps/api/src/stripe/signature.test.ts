import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { StripeSignatureError, verifyStripeSignature } from './signature.js';

const secret = 'whsec_test_secret';
const body = JSON.stringify({
  id: 'evt_test_1',
  type: 'customer.subscription.updated',
  created: 1_700_000_000,
  data: { object: {} },
});
const nowSeconds = 1_700_000_300;
const now = () => nowSeconds * 1000;

function sign(timestamp: number, payload: string, key = secret): string {
  return createHmac('sha256', key).update(`${timestamp}.${payload}`).digest('hex');
}

describe('verifyStripeSignature', () => {
  it('accepts a validly signed payload', () => {
    const header = `t=${nowSeconds},v1=${sign(nowSeconds, body)}`;
    const event = verifyStripeSignature(body, header, secret, { now });
    expect(event.id).toBe('evt_test_1');
  });

  it('accepts when one of multiple v1 signatures matches', () => {
    const header = `t=${nowSeconds},v1=deadbeef,v1=${sign(nowSeconds, body)}`;
    const event = verifyStripeSignature(body, header, secret, { now });
    expect(event.type).toBe('customer.subscription.updated');
  });

  it('rejects a tampered body', () => {
    const header = `t=${nowSeconds},v1=${sign(nowSeconds, body)}`;
    const tampered = body.replace('evt_test_1', 'evt_evil');
    expect(() => verifyStripeSignature(tampered, header, secret, { now })).toThrow(
      StripeSignatureError,
    );
  });

  it('rejects a signature made with the wrong secret', () => {
    const header = `t=${nowSeconds},v1=${sign(nowSeconds, body, 'whsec_other')}`;
    expect(() => verifyStripeSignature(body, header, secret, { now })).toThrow(
      StripeSignatureError,
    );
  });

  it('rejects timestamps outside the tolerance window', () => {
    const stale = nowSeconds - 301;
    const header = `t=${stale},v1=${sign(stale, body)}`;
    expect(() => verifyStripeSignature(body, header, secret, { now })).toThrow(
      /tolerance/,
    );
  });

  it('rejects headers without a v1 signature', () => {
    expect(() => verifyStripeSignature(body, `t=${nowSeconds}`, secret, { now })).toThrow(
      StripeSignatureError,
    );
  });
});
