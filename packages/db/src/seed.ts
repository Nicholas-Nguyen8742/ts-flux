import { config } from 'dotenv';
import { closeDb, getDb } from './client.js';
import { tenants } from './schema.js';

config({ path: ['.env', '../../.env'] });

const sampleTenants = [
  { stripeCustomerId: 'cus_test_alpha', status: 'inactive' },
  { stripeCustomerId: 'cus_test_beta', status: 'inactive' },
];

async function main(): Promise<void> {
  const db = getDb();
  const inserted = await db
    .insert(tenants)
    .values(sampleTenants)
    .onConflictDoNothing({ target: tenants.stripeCustomerId })
    .returning({ id: tenants.id });
  console.log(`seed complete: ${inserted.length} new tenant(s), ${sampleTenants.length} total defined`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
