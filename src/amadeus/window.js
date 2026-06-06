import { getWindows, getActiveWindow } from '@nut-tree-fork/nut-js';
import { windowTitleRegex } from '../config.js';
import { logger } from '../logger.js';

/**
 * Finds the JFE window by matching its title against the configured regex.
 *
 * We re-scan every call rather than cache the handle, because window handles
 * can become stale (the user might close & reopen JFE, or the launcher might
 * spawn a fresh child window). The scan is fast enough that this is fine.
 *
 * @returns {Promise<Window>}
 * @throws if no matching window is found.
 */
export async function findJfeWindow() {
  const windows = await getWindows();
  for (const w of windows) {
    let title = '';
    try {
      title = await w.getTitle();
    } catch {
      continue; // Some windows refuse to report their title; skip.
    }
    if (windowTitleRegex.test(title)) {
      logger.debug({ title }, 'found JFE window');
      return w;
    }
  }
  throw new Error(
    `JFE window not found. Tried regex: ${windowTitleRegex}. ` +
    `Open JFE and adjust JFE_WINDOW_TITLE_REGEX in .env if needed.`
  );
}

/**
 * Brings the JFE window to focus. Returns the window handle.
 */
export async function focusJfeWindow() {
  const w = await findJfeWindow();
  await w.focus();
  // Small breathing room so subsequent keystrokes land in the right window.
  await new Promise(r => setTimeout(r, 150));
  return w;
}

/**
 * Quick sanity check: is JFE currently the foreground window?
 * Useful for assertions after focus().
 */
export async function isJfeFocused() {
  try {
    const active = await getActiveWindow();
    const title = await active.getTitle();
    return windowTitleRegex.test(title);
  } catch {
    return false;
  }
}
