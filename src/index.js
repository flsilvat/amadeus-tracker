import { config } from './config.js';
import { logger } from './logger.js';
import { initDb } from './storage/sqlite.js';
import { initFirestore } from './storage/firestore.js';
import { createApp } from './server/app.js';

// Scheduler intentionally disabled — JFE is driven on manual triggers only
// (POST /groups, POST /groups/:id/refresh, POST /refresh-all, POST /raw).
// To re-enable cron + keepalive, uncomment the two scheduler lines below.
//
// import { startScheduler } from './scheduler.js';

initDb();
initFirestore();

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, dryRun: config.DRY_RUN }, 'server listening (manual mode — no scheduler)');
});

// const scheduler = startScheduler();

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  // scheduler?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
