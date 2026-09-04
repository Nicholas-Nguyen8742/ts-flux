import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  stripeCustomerId: varchar('stripe_customer_id').unique().notNull(),
  status: varchar('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  stripeSubscriptionId: varchar('stripe_subscription_id').unique().notNull(),
  status: varchar('status').notNull(),
  planTier: varchar('plan_tier').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const infrastructureResources = pgTable('infrastructure_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  kind: varchar('kind').notNull(),
  externalRef: varchar('external_ref').notNull(),
  status: varchar('status').notNull().default('active'),
  // Unique: replayed workflows cannot create duplicate resources (BRD R2).
  idempotencyKey: varchar('idempotency_key').unique().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    // Unique: reprocessing the same Stripe event cannot enqueue twice (BRD R2).
    idempotencyKey: varchar('idempotency_key').unique().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    processedAt: timestamp('processed_at'),
  },
  (table) => [
    // Hot path for the relay: "oldest unprocessed events first".
    index('outbox_unprocessed_idx').on(table.createdAt).where(sql`processed_at IS NULL`),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type InfrastructureResource = typeof infrastructureResources.$inferSelect;
export type NewInfrastructureResource = typeof infrastructureResources.$inferInsert;
export type OutboxEvent = typeof outbox.$inferSelect;
export type NewOutboxEvent = typeof outbox.$inferInsert;
