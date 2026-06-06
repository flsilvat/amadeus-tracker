/**
 * Initialises the SQLite database file and schema. Idempotent.
 * Run with: npm run init:db
 */
import { initDb } from '../src/storage/sqlite.js';

initDb();
console.log('Database initialised.');
process.exit(0);
