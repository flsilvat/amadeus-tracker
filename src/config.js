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
