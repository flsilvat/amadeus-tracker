import PQueue from 'p-queue';
import { logger } from './logger.js';

/**
 * Global serialization queue.
 *
 * Concurrency is locked to 1: the JFE window can only do one thing at a time.
 * Both the scheduler and HTTP endpoints push work onto this queue, so they
 * automatically wait for each other instead of fighting over the window.
 */
export const jfeQueue = new PQueue({ concurrency: 1 });

jfeQueue.on('active', () => {
  logger.debug({ size: jfeQueue.size, pending: jfeQueue.pending }, 'queue active');
});

/**
 * Convenience wrapper that adds a labelled task and logs around it.
 */
export async function enqueue(label, fn) {
  return jfeQueue.add(async () => {
    const start = Date.now();
    logger.info({ label }, 'task start');
    try {
      const result = await fn();
      logger.info({ label, ms: Date.now() - start }, 'task done');
      return result;
    } catch (err) {
      logger.error({ label, ms: Date.now() - start, err: err.message }, 'task failed');
      throw err;
    }
  });
}
