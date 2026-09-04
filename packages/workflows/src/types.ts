import { z } from 'zod';
import { subscriptionActivatedSchema } from '@repo/events';

/**
 * Data carried by the Inngest `app/subscription.activated` event: the
 * validated outbox payload plus the envelope idempotency key, merged by the
 * worker bridge.
 */
export const provisioningEventDataSchema = subscriptionActivatedSchema.extend({
  idempotencyKey: z.string().min(1),
});
export type ProvisioningEventData = z.infer<typeof provisioningEventDataSchema>;
