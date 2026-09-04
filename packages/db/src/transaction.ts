import { getDb, type Database } from './client.js';

/** The transaction handle passed to `withTransaction` callbacks. */
export type Transaction = Parameters<Database['transaction']>[0] extends (
  tx: infer T,
) => unknown
  ? T
  : never;

/**
 * Atomic transaction helper (BRD R3): everything `fn` writes commits or
 * rolls back together. Business-state updates and outbox inserts MUST share
 * one call to guarantee consistency.
 */
export async function withTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  return db.transaction(fn);
}
