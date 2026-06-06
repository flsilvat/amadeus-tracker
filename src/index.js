import { config } from './config.js';
import { logger } from './logger.js';
import { initDb } from './storage/sqlite.js';
import { initFirestore } from './storage/firestore.js';
import { startCommandProcessor } from './commands/processor.js';
import { createApp } from './server/app.js';

// Scheduler intentionally disabled — JFE is driven on manual triggers only
// (POST /groups, POST /groups/:id/refresh, POST /refresh-all, POST /raw).
// To re-enable cron + keepalive, uncomment the two scheduler lines below.
//
// import { startScheduler } from './scheduler.js';

initDb();
initFirestore();

// Phase 4: listen for web-queued commands (create/refresh) and run them.
// No-op if Firestore is disabled. This is event-driven — it only acts when you
// enqueue something from the app, never on a timer.
const stopCommandProcessor = config.FIRESTORE_ENABLED ? startCommandProcessor() : null;

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, dryRun: config.DRY_RUN }, 'server listening (manual mode — no scheduler)');
});

// const scheduler = startScheduler();

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  stopCommandProcessor?.();
  // scheduler?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
