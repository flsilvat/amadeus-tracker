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
  // Wait (ms) after Ctrl+C before polling the clipboard. Small drain only —
  // chorded copy is immediate, unlike the old Device-menu route.
  COPY_SETTLE_MS: z.coerce.number().default(150),
  // Capture verification: a copy that equals the pre-command screen (or fails
  // the expected-content check) is retried up to CAPTURE_RETRIES times,
  // waiting CAPTURE_RETRY_MS between attempts. This is what protects you when
  // Amadeus renders slower than the settle time — without it, a too-early copy
  // silently loses data (e.g. pagination stops a page early).
  CAPTURE_RETRIES: z.coerce.number().default(3),
  CAPTURE_RETRY_MS: z.coerce.number().default(1500),
  // Backspaces sent to wipe the command line before typing each command.
  // With Ctrl+C copying there's no known leak source, so this is just a cheap
  // safety net. Set to 0 to disable entirely.
  CLEAR_BACKSPACES: z.coerce.number().default(3),
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
