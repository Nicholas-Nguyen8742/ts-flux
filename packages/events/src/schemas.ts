import { z } from 'zod';

export const planTierSchema = z.enum(['pro', 'enterprise']);
export type PlanTier = z.infer<typeof planTierSchema>;

/**
 * Emitted when a subscription becomes newly billable (created as active, or
 * moved from a lapsed state back to active/trialing).
 */
export const subscriptionActivatedSchema = z.object({
  tenantId: z.string().uuid(),
  stripeSubscriptionId: z.string().min(1),
  planTier: planTierSchema,
});
export type SubscriptionActivated = z.infer<typeof subscriptionActivatedSchema>;

/**
 * Emitted when a subscription changes but is not newly active
 * (e.g. moved to past_due). Stripe state is mirrored verbatim (BRD R1).
 */
export const subscriptionUpdatedSchema = subscriptionActivatedSchema.extend({
  status: z.string().min(1),
});
export type SubscriptionUpdated = z.infer<typeof subscriptionUpdatedSchema>;

export const subscriptionCancelledSchema = z.object({
  tenantId: z.string().uuid(),
  stripeSubscriptionId: z.string().min(1),
});
export type SubscriptionCancelled = z.infer<typeof subscriptionCancelledSchema>;

export const resourceProvisionedSchema = z.object({
  tenantId: z.string().uuid(),
  resourceId: z.string().uuid(),
  kind: z.string().min(1),
  externalRef: z.string().min(1),
});
export type ResourceProvisioned = z.infer<typeof resourceProvisionedSchema>;

export const resourceFailedSchema = z.object({
  tenantId: z.string().uuid(),
  kind: z.string().min(1),
  reason: z.string(),
});
export type ResourceFailed = z.infer<typeof resourceFailedSchema>;
