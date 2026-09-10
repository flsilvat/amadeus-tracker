/**
 * One-off: copy curated groups (Firestore collection `flightGroups`) into the
 * local SQLite database so they show up in local mode (VITE_LOCAL_MODE=true).
 *
 * Uses the admin service account (bypasses Firestore rules) and needs network
 * access to Google — run it from a network that isn't blocking Firebase.
 * Safe to re-run: groups are upserted by id, nothing is deleted.
 *
 *   node scripts/import-firestore-flight-groups.js             # import
 *   node scripts/import-firestore-flight-groups.js --dry-run   # list only
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { config } from '../src/config.js';
import { initDb, upsertFlightGroup, listFlightGroups } from '../src/storage/sqlite.js';

const dryRun = process.argv.includes('--dry-run');
const TIMEOUT_MS = 30000;

if (!existsSync(config.FIREBASE_SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ service account file not found at ${config.FIREBASE_SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const sa = JSON.parse(readFileSync(config.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'));
if (!getApps().length) initializeApp({ credential: cert(sa), projectId: sa.project_id });
const firestore = getFirestore();

const toIso = (v) => {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
  return typeof v === 'string' && v ? v : undefined;
};

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, reject) => setTimeout(() => reject(new Error(
    `no answer from Firestore after ${ms / 1000}s — is this network blocking Google/Firebase?`
  )), ms).unref()),
]);

try {
  const snap = await withTimeout(firestore.collection('flightGroups').get(), TIMEOUT_MS);
  const groups = snap.docs.map((d) => {
    const g = d.data();
    return {
      id: d.id,
      name: g.name || 'My journey',
      flights: Array.isArray(g.flights) ? g.flights : [],
      myStfCode: g.myStfCode ?? null,
      myDoj: g.myDoj ?? null,
      createdBy: g.createdBy ?? null,
      createdAt: toIso(g.createdAt),
      updatedAt: toIso(g.updatedAt),
    };
  });

  console.log(`Found ${groups.length} curated group(s) in Firestore (project ${sa.project_id}):`);
  for (const g of groups) console.log(`  - ${g.name}  (${g.flights.length} flight(s), id ${g.id})`);

  if (dryRun) {
    console.log('\nDry run — nothing written.');
    process.exit(0);
  }

  initDb();
  for (const g of groups) upsertFlightGroup(g);
  console.log(`\n✅ Imported ${groups.length} group(s) into ${config.DB_PATH}. Local total: ${listFlightGroups().length}.`);
  console.log('Reload the web app — the groups appear on the next poll (≤5s).');
  process.exit(0);
} catch (err) {
  console.error('❌ Import failed:', err.message);
  process.exit(1);
}
