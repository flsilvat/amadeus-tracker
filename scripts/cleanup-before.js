// =============================================================================
// One-off cleanup: delete observation data captured BEFORE a cutoff date from
// BOTH stores (Firestore mirror + local SQLite), so bad early captures from the
// parser/NMD era are gone everywhere.
//
//   node scripts/cleanup-before.js 2026-06-08            ← DRY RUN (counts only)
//   node scripts/cleanup-before.js 2026-06-08 --apply    ← actually deletes
//
// What it touches:
//   - observations with queryTime <  <cutoff>  (Firestore + SQLite)
//   - their queue rows in SQLite (queue_entries.query_time < cutoff)
// What it does NOT touch:
//   - groups, flights, appState, commands. Flight docs are upserted with
//     corrected data on your next Re-scan/Refresh anyway.
//
// Run it from the project root on the laptop (needs service-account.json and
// the SQLite db). Stop the tracker service first to avoid writes mid-cleanup.
// =============================================================================
import { logger } from '../src/logger.js';
import { initDb, getDb } from '../src/storage/sqlite.js';
import { initFirestore } from '../src/storage/firestore.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!dateArg) {
  console.error('Usage: node scripts/cleanup-before.js YYYY-MM-DD [--apply]');
  process.exit(1);
}
// ISO timestamps compare lexically, so "< 2026-06-08" means strictly before
// that day (a queryTime ON the 8th starts "2026-06-08T…" which sorts after).
const cutoff = dateArg;

async function main() {
  console.log(`Cleanup of observations captured before ${cutoff}`);
  console.log(apply ? '*** APPLY MODE — data will be deleted ***' : '(dry run — nothing will be deleted; add --apply to execute)');

  // ---------- SQLite ----------
  initDb();
  const db = getDb();
  const obsCount = db.prepare(`SELECT COUNT(*) c FROM observations WHERE query_time < ?`).get(cutoff).c;
  const qCount = db.prepare(`SELECT COUNT(*) c FROM queue_entries WHERE query_time < ?`).get(cutoff).c;
  console.log(`SQLite: ${obsCount} observations, ${qCount} queue rows before cutoff`);
  if (apply) {
    db.prepare(`DELETE FROM queue_entries WHERE query_time < ?`).run(cutoff);
    db.prepare(`DELETE FROM observations WHERE query_time < ?`).run(cutoff);
    console.log('SQLite: deleted.');
  }

  // ---------- Firestore ----------
  const fs = initFirestore();
  if (!fs) {
    console.log('Firestore: mirror not configured/reachable — skipped (only SQLite handled).');
    return;
  }
  const snap = await fs.collection('observations').where('queryTime', '<', cutoff).get();
  console.log(`Firestore: ${snap.size} observation docs before cutoff`);
  if (apply && snap.size > 0) {
    let deleted = 0;
    const docs = snap.docs;
    while (deleted < docs.length) {
      const batch = fs.batch();
      docs.slice(deleted, deleted + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted = Math.min(deleted + 400, docs.length);
      console.log(`Firestore: deleted ${deleted}/${docs.length}`);
    }
  }

  console.log(apply
    ? 'Done. Open the app and hit "Refresh loads" on your trips to capture fresh observations.'
    : 'Dry run complete. Re-run with --apply to delete the above.');
}

main().catch((err) => {
  logger.error({ err: err.message }, 'cleanup failed');
  console.error('Cleanup failed:', err.message);
  process.exit(1);
});
