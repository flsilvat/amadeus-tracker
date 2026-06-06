import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3737),
  DRY_RUN: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  JFE_WINDOW_TITLE_REGEX: z.string().default('Customer Management.*Alt[eé]a'),
  CLIPBOARD_TIMEOUT_MS: z.coerce.number().default(10000),
  // Wait between typing the INITIAL command (AN, LL) and triggering Copy —
  // first calls hit the Amadeus server, so they need more time to render.
  INITIAL_SETTLE_MS: z.coerce.number().default(5000),
  // Wait for MD pagination — already-loaded data, much faster.
  MD_SETTLE_MS: z.coerce.number().default(1200),
  // Per-keystroke delay used by nut-js. Higher = more reliable, slightly slower.
  KEYBOARD_AUTO_DELAY_MS: z.coerce.number().default(100),
  // Wait (ms) after Alt+D opens the Device menu before pressing N (Copy
  // Content). Too short and N lands in the command line instead of the menu,
  // which then echoes into the next command (e.g. "MD" -> "NMD").
  MENU_OPEN_MS: z.coerce.number().default(250),
  // Wait (ms) after pressing N for the menu to close and the keypress to drain.
  MENU_SETTLE_MS: z.coerce.number().default(300),
  // Backspaces sent to wipe the command line before typing each command, as a
  // safety net against a stray leaked character. Harmless when the line is empty.
  CLEAR_BACKSPACES: z.coerce.number().default(8),
  // Stop AN pagination as soon as a connecting itinerary appears. AN lists
  // direct flights first, so this skips the (discarded) connection pages. Set
  // to "false" if you ever find a direct flight being missed.
  AN_STOP_AT_CONNECTIONS: z.enum(['true', 'false']).default('true').transform(v => v === 'true'),
  REFRESH_CRON: z.string().default('*/15 * * * *'),
  KEEPALIVE_SECONDS: z.coerce.number().default(240),
  DB_PATH: z.string().default('./data/tracker.db'),
  HOME_AIRPORT: z.string().length(3).default('LHR'),
  // --- Firestore mirror (phase 2) ---
  FIRESTORE_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('./service-account.json'),
});

export const config = schema.parse(process.env);

// Pre-compile the window-title regex once.
export const windowTitleRegex = new RegExp(config.JFE_WINDOW_TITLE_REGEX, 'i');
