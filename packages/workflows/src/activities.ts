import { createHash } from 'node:crypto';
import type { PlanTier } from '@repo/events';

export interface ProvisionedResource {
  kind: string;
  externalRef: string;
}

export interface ProvisioningOptions {
  mode?: 'fake' | 'http';
  apiUrl?: string;
}

/**
 * Calls the external provisioning system.
 *
 * Modes:
 * - `fake` (default locally): deterministic resources derived from the
 *   inputs, so replays produce identical refs and tests are stable.
 * - `http`: POSTs to PROVISIONING_API_URL with the idempotency key as a
 *   header, so the provider can deduplicate on its side too.
 */
export async function callProvisioningAPI(
  tenantId: string,
  planTier: PlanTier,
  idempotencyKey: string,
  options: ProvisioningOptions = {},
): Promise<ProvisionedResource[]> {
  const mode = options.mode ?? (process.env.PROVISIONING_MODE === 'http' ? 'http' : 'fake');

  if (mode === 'fake') {
    return fakeProvision(tenantId, planTier);
  }

  const apiUrl = options.apiUrl ?? process.env.PROVISIONING_API_URL;
  if (!apiUrl) throw new Error('PROVISIONING_API_URL is not set');

  const response = await fetch(`${apiUrl}/provision`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({ tenantId, planTier }),
  });
  if (!response.ok) {
    throw new Error(`Provisioning API failed with status ${response.status}`);
  }
  const body = (await response.json()) as { resources?: ProvisionedResource[] };
  if (!Array.isArray(body.resources)) {
    throw new Error('Provisioning API returned an unexpected response shape');
  }
  return body.resources;
}

function fakeProvision(tenantId: string, planTier: PlanTier): ProvisionedResource[] {
  const digest = createHash('sha256').update(`${tenantId}:${planTier}`).digest('hex');
  return [
    { kind: 'database', externalRef: `db_${digest.slice(0, 12)}` },
    { kind: 'api_key', externalRef: `key_${digest.slice(12, 24)}` },
  ];
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** Log-based stub provider; swap for a real transport in production. */
export function createLoggingEmailProvider(): EmailProvider {
  return {
    async send(message) {
      console.log(JSON.stringify({ level: 'info', event: 'email.sent', ...message }));
    },
  };
}
