import { keyboard, Key } from '@nut-tree-fork/nut-js';
import clipboard from 'clipboardy';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { focusJfeWindow } from './window.js';
import { sampleResponseFor } from './samples.js';

// JFE is an old Java app; instant input occasionally drops characters.
// Configurable via KEYBOARD_AUTO_DELAY_MS in .env.
keyboard.config.autoDelayMs = config.KEYBOARD_AUTO_DELAY_MS;

/**
 * Runs a single cryptic command in JFE and returns one page of clipboard text.
 *
 * @param {string} command  The cryptic command (e.g. "ANBA15JULLHRSEA" or "MD").
 * @param {{ skipPreflight?: boolean, settleMs?: number }} options
 *   skipPreflight=true skips the inactivity-popup dismissal Enter. Use this
 *   for pagination commands like MD — an empty Enter resets the AN/LL
 *   display context and MD silently no-ops.
 *   settleMs overrides the wait between typing the command and triggering
 *   Copy. Defaults to INITIAL_SETTLE_MS; pass MD_SETTLE_MS for MD calls.
 */
export async function runCommand(command, { skipPreflight = false, settleMs } = {}) {
  if (config.DRY_RUN) {
    logger.warn({ command }, 'DRY_RUN: returning sample response');
    return {
      command,
      response: sampleResponseFor(command),
      capturedAt: new Date().toISOString(),
    };
  }

  const settle = settleMs ?? config.INITIAL_SETTLE_MS;

  const sentinel = `__JFE_SENTINEL_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
  await clipboard.write(sentinel);

  await focusJfeWindow();

  if (!skipPreflight) {
    await tapEnter();
    await sleep(200);
  }

  await keyboard.type(command);
  await tapEnter();

  await sleep(settle);
  await triggerCopyContent();

  const response = await waitForClipboardChange(sentinel, config.CLIPBOARD_TIMEOUT_MS);
  return { command, response, capturedAt: new Date().toISOString() };
}

/**
 * Runs a command, then pages through with MD until completion. Used for both
 * AN (no explicit end marker — we stop when MD returns identical content) and
 * LL (stop on END OF DISPLAY, or when MD repeats).
 *
 * Returns the concatenated raw text across all pages, plus a small meta block
 * so callers can see whether pagination terminated cleanly.
 *
 * @param {string} initialCommand
 * @param {{ endMarker?: RegExp, maxPages?: number }} opts
 */
export async function runCommandPaginated(initialCommand, opts = {}) {
  const endMarker = opts.endMarker ?? /END OF DISPLAY/;
  const maxPages = opts.maxPages ?? 20;

  const first = await runCommand(initialCommand);
  const pages = [first.response];
  const seen = new Set([first.response]);   // any previously seen page, not just last
  let pageCount = 1;
  let hitEnd = endMarker.test(first.response);

  logger.info(
    { command: initialCommand, page: 1, bytes: first.response.length, hitEnd },
    'pagination: initial page'
  );

  while (!hitEnd && pageCount < maxPages) {
    // MD must NOT have the pre-flight Enter (would lose AN/LL context).
    // Use the shorter MD settle time — page is already loaded server-side.
    const next = await runCommand('MD', {
      skipPreflight: true,
      settleMs: config.MD_SETTLE_MS,
    });

    if (seen.has(next.response)) {
      logger.info(
        { pageCount, bytes: next.response.length },
        'pagination: page matches a previous page (loop/end), stopping'
      );
      break;
    }
    seen.add(next.response);

    pages.push(next.response);
    pageCount++;
    hitEnd = endMarker.test(next.response);

    logger.info(
      { page: pageCount, bytes: next.response.length, hitEnd, tail: next.response.slice(-120).replace(/\s+/g, ' ').trim() },
      'pagination: MD page'
    );
  }

  if (!hitEnd && pageCount >= maxPages) {
    logger.warn({ command: initialCommand, maxPages }, 'pagination cap reached without end marker');
  }

  return {
    command: initialCommand,
    response: pages.join('\n'),
    pages: pageCount,
    complete: hitEnd,
    capturedAt: first.capturedAt,
  };
}

/**
 * Sends a keepalive Enter to JFE. Dismisses any inactivity popup if it's up.
 */
export async function sendKeepalive() {
  if (config.DRY_RUN) return;
  try {
    await focusJfeWindow();
    await tapEnter();
    logger.debug('keepalive sent');
  } catch (err) {
    logger.warn({ err: err.message }, 'keepalive failed');
  }
}

// ----- low-level helpers -----

async function tapEnter() {
  await keyboard.pressKey(Key.Enter);
  await keyboard.releaseKey(Key.Enter);
}

async function triggerCopyContent() {
  // Open Device menu (Alt+D), then press N for "Copy Content to Clipboard".
  await keyboard.pressKey(Key.LeftAlt);
  await keyboard.pressKey(Key.D);
  await keyboard.releaseKey(Key.D);
  await keyboard.releaseKey(Key.LeftAlt);
  await sleep(120);
  await keyboard.pressKey(Key.N);
  await keyboard.releaseKey(Key.N);
  // Let the menu fully close and the N keypress drain before any subsequent
  // typing — otherwise the N can intermittently prepend to the next command
  // (e.g. "MD" arrives at JFE as "NMD" and gets rejected).
  await sleep(250);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForClipboardChange(sentinel, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(150);
    const current = await clipboard.read();
    if (current && current !== sentinel && current.length > 0) {
      return current;
    }
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for clipboard to update. ` +
    `Possible causes: JFE not focused, command syntax rejected, or the ` +
    `Device → Copy Content menu accelerator (Alt+D, N) differs in your build.`
  );
}
