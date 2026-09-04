import { inngest } from '@repo/workflows';
import type { EventEnvelope } from '@repo/events';

/**
 * Outbox event names → Inngest event names. The `app/` prefix mapping lives
 * only here, so neither the outbox nor the workflows leak the other side's
 * naming convention.
 */
export function toInngestEventName(eventType: string): string {
  return `app/${eventType}`;
}

/**
 * Forwards a validated envelope to Inngest. The envelope idempotency key is
 * merged into the event data so workflow steps can dedupe on it.
 */
export async function bridgeEnvelopeToInngest(envelope: EventEnvelope): Promise<void> {
  await inngest.send({
    name: toInngestEventName(envelope.eventType),
    data: { ...envelope.payload, idempotencyKey: envelope.idempotencyKey },
  });
}
