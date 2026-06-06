import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { jfeQueue, enqueue } from './queue.js';
import { sendKeepalive } from './amadeus/automator.js';
import { refreshAllActiveGroups } from './service.js';

/**
 * Two scheduled jobs:
 *
 *   1. REFRESH_CRON — re-runs LL for every active group on schedule.
 *      Default every 15 min. Both this job and the HTTP endpoint go through
 *      the same queue, so they never collide.
 *
 *   2. KEEPALIVE_SECONDS — if the queue has been idle for ~that long, send
 *      a harmless Enter to JFE to dismiss the inactivity popup. We only do
 *      this when nothing else is happening; if the refresh job is already
 *      running, that's all the activity JFE needs.
 */
export function startScheduler() {
  const refresh = cron.schedule(config.REFRESH_CRON, async () => {
    logger.info('scheduled refresh: starting');
    try {
      const results = await refreshAllActiveGroups();
      logger.info({ groups: results.length }, 'scheduled refresh: done');
    } catch (err) {
      logger.error({ err: err.message }, 'scheduled refresh: failed');
    }
  });

  let keepaliveTimer = null;
  if (config.KEEPALIVE_SECONDS > 0) {
    let lastActivity = Date.now();
    jfeQueue.on('active', () => { lastActivity = Date.now(); });

    keepaliveTimer = setInterval(() => {
      const idleSec = (Date.now() - lastActivity) / 1000;
      if (idleSec >= config.KEEPALIVE_SECONDS && jfeQueue.size === 0 && jfeQueue.pending === 0) {
        enqueue('keepalive', () => sendKeepalive()).catch(() => {});
        lastActivity = Date.now();
      }
    }, Math.max(15_000, config.KEEPALIVE_SECONDS * 1000 / 4));
  }

  logger.info({ cron: config.REFRESH_CRON, keepaliveSec: config.KEEPALIVE_SECONDS },
    'scheduler started');

  return {
    stop() {
      refresh.stop();
      if (keepaliveTimer) clearInterval(keepaliveTimer);
    },
  };
}
