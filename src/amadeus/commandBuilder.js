const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

/**
 * Converts an ISO date (YYYY-MM-DD) to Amadeus DDMMM format ("11JUL").
 */
export function toAmadeusDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error(`Bad ISO date: ${isoDate}`);
  const [, , month, day] = m;
  return `${day}${MONTHS[parseInt(month, 10) - 1]}`;
}

/**
 * Normalises a BA flight number to "BA0193" form (4-digit zero-padded).
 * Accepts: "193", "BA193", "BA0193", "ba 193".
 */
export function normaliseFlightNo(input) {
  const digits = String(input).replace(/\D/g, '');
  if (!digits) throw new Error(`Cannot extract flight digits from: ${input}`);
  return 'BA' + digits.padStart(4, '0');
}

/**
 * BA-filtered availability command: ANBA{DDMMM}{ORIG}{DEST}
 *
 * The "BA" carrier filter tells Amadeus to only show BA-marketed flights,
 * which dramatically reduces the response size and — critically — strips
 * out multi-airline connecting routings that were polluting our flight list.
 *
 * Example: buildAN("2026-07-15", "LHR", "SEA") → "ANBA15JULLHRSEA"
 */
export function buildAN(isoDate, origin, destination) {
  const date = toAmadeusDate(isoDate);
  return `ANBA${date}${origin.toUpperCase()}${destination.toUpperCase()}`;
}

/**
 * Loading list command: LL/{FLIGHT}/{DDMMM}/{ORIG}
 * Example: buildLL("BA193", "2026-07-11", "LHR") → "LL/BA0193/11JUL/LHR"
 */
export function buildLL(flightNo, isoDate, origin) {
  const fn = normaliseFlightNo(flightNo);
  const date = toAmadeusDate(isoDate);
  return `LL/${fn}/${date}/${origin.toUpperCase()}`;
}
