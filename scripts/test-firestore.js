/**
 * Quick Firestore connectivity smoke test.
 * Run with: node scripts/test-firestore.js
 *
 * Writes a tiny document to /diagnostics/{timestamp}, reads it back,
 * deletes it. Confirms credentials work and rules permit the admin SDK.
 */
import { initFirestore } from '../src/storage/firestore.js';
import { config } from '../src/config.js';

if (!config.FIRESTORE_ENABLED) {
  console.error('❌ FIRESTORE_ENABLED is false in .env — set it to true and rerun.');
  process.exit(1);
}

const db = initFirestore();
if (!db) {
  console.error('❌ Firestore init returned null. Check service-account.json path.');
  process.exit(1);
}

const ts = new Date().toISOString();
const ref = db.collection('diagnostics').doc('smoke-' + Date.now());

try {
  await ref.set({ message: 'hello from amadeus-tracker', when: ts });
  console.log('✅ write OK');
  const snap = await ref.get();
  console.log('✅ read OK:', snap.data());
  await ref.delete();
  console.log('✅ delete OK');
  console.log('\nFirestore is wired up. The mirror will activate on the next refresh.');
  process.exit(0);
} catch (err) {
  console.error('❌ Firestore round-trip failed:', err.message);
  process.exit(1);
}
