import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

interface DbInstance {
  db: Database;
  sql: postgres.Sql;
}

let defaultInstance: DbInstance | null = null;

export function createDb(connectionString?: string): Database {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const sql = postgres(url, { max: 10 });
  return drizzle(sql, { schema });
}

/** Lazy singleton so importing @repo/db never opens a connection eagerly. */
export function getDb(): Database {
  if (!defaultInstance) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const sql = postgres(url, { max: 10 });
    defaultInstance = { db: drizzle(sql, { schema }), sql };
  }
  return defaultInstance.db;
}

export async function closeDb(): Promise<void> {
  if (defaultInstance) {
    const { sql } = defaultInstance;
    defaultInstance = null;
    await sql.end({ timeout: 5 });
  }
}
