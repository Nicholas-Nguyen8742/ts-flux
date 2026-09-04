import { z } from 'zod';
import {
  resourceFailedSchema,
  resourceProvisionedSchema,
  subscriptionActivatedSchema,
  subscriptionCancelledSchema,
  subscriptionUpdatedSchema,
} from './schemas.js';

/**
 * Registry of every event type that may cross the wire, mapped to the Zod
 * schema that validates its payload. Adding a new domain event means adding
 * one entry here.
 */
export const EVENT_TYPES = {
  'subscription.activated': subscriptionActivatedSchema,
  'subscription.updated': subscriptionUpdatedSchema,
  'subscription.cancelled': subscriptionCancelledSchema,
  'resource.provisioned': resourceProvisionedSchema,
  'resource.failed': resourceFailedSchema,
} as const;

export type EventType = keyof typeof EVENT_TYPES;

/** Wire format shared by the outbox, Redis Streams, and the worker bridge. */
export const eventEnvelopeSchema = z.object({
  eventType: z.string(),
  payload: z.unknown(),
  idempotencyKey: z.string().min(1),
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export type TypedEvent = {
  [K in EventType]: {
    eventType: K;
    payload: z.infer<(typeof EVENT_TYPES)[K]>;
    idempotencyKey: string;
  };
}[EventType];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_TYPES, value);
}

/**
 * Validates an envelope and its payload against the registry. Throws on
 * unknown event types or malformed payloads — callers decide whether that
 * means retry or dead-letter.
 */
export function parseEnvelope(raw: unknown): TypedEvent {
  const envelope = eventEnvelopeSchema.parse(raw);
  if (!isEventType(envelope.eventType)) {
    throw new Error(`Unknown event type: ${envelope.eventType}`);
  }
  const payloadSchema = EVENT_TYPES[envelope.eventType];
  const payload = payloadSchema.parse(envelope.payload);
  return {
    eventType: envelope.eventType,
    payload,
    idempotencyKey: envelope.idempotencyKey,
  } as TypedEvent;
}
