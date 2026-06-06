/**
 * Parsers for AN (availability) and LL (loading list) cryptic responses.
 *
 * Both parsers are written to be idempotent against concatenated multi-page
 * text. Lines that appear more than once (because a paginated copy overlapped
 * with the previous one) are deduplicated naturally — flights by flight number,
 * cabin rows by cabin letter, queue entries by line number.
 */

// =============================================================================
// AN — availability response
// =============================================================================

// Flight header line — REQUIRES a leading line number, which is what
// distinguishes a top-level option (direct flight or first leg of a
// connection) from a connection-continuation line (no line number, starts
// with the carrier code). Examples we match:
//   "1AA:BA1504  F4 A4 ... /LHR 3 DFW D  0855  1300  E0/77W"
//   "3   BA 193  F2 A1 ... /LHR 5 DFW D  1255  1705  E0/388"
// Examples we DON'T match (correctly):
//   "EI:BA5914  Y9 ... /DUB 2 LHR 2  ..."   ← connection 2nd leg, no line number
//   "            W6 E6 T2 ..."              ← additional booking classes
//   "OPERATED BY AMERICAN AIRLINES"
const AN_FLIGHT_RE = new RegExp(
  '^\\s*(\\d+)\\s*' +                   // (1) line number REQUIRED
  '([A-Z0-9]{2}:)?\\s*' +               // (2) "AA:" style codeshare prefix
  '(BA)\\s*' +                          // (3) marketing carrier (BA)
  '(\\d{1,4})\\s+' +                    // (4) flight digits
  '.*?' +                               // booking classes (lazy)
  '/([A-Z]{3})\\s+\\S+\\s+' +           // (5) origin + terminal
  '([A-Z]{3})\\s+\\S?\\s*' +            // (6) destination + optional D marker
  '(\\d{4})\\s+' +                      // (7) departure HHMM
  '(\\d{4})\\s+' +                      // (8) arrival HHMM
  'E\\d/([A-Z0-9]{3})',                 // (9) equipment
);

/**
 * Parses an AN response (possibly multi-page concatenation).
 */
export function parseAN(text, ctx = {}) {
  const lines = String(text).split(/\r?\n/);
  const flights = [];
  const seen = new Set();
  let header = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('** BRITISH AIRWAYS - AN **')) {
      header = line.trim();
      continue;
    }

    const m = AN_FLIGHT_RE.exec(line);
    if (!m) continue;
    const [, , codeshare, , digits, origin, destination, dep, arr, equipment] = m;

    // Look ahead up to 3 lines for "OPERATED BY".
    let operatedBy = null;
    for (let j = 1; j <= 3 && i + j < lines.length; j++) {
      const look = lines[i + j];
      if (AN_FLIGHT_RE.test(look)) break;
      const op = /OPERATED BY (.+?)(?:\s+FOR\b|$)/.exec(look);
      if (op) { operatedBy = op[1].trim(); break; }
    }

    const flightNo = 'BA' + digits.padStart(4, '0');
    const key = `${flightNo}|${origin}|${destination}|${dep}|${arr}`;
    if (seen.has(key)) continue;
    seen.add(key);

    flights.push({
      flightNo,
      origin,
      destination,
      depTime: `${dep.slice(0, 2)}:${dep.slice(2)}`,
      arrTime: `${arr.slice(0, 2)}:${arr.slice(2)}`,
      equipment,
      operatedBy,
      isBAOperated: !codeshare && !operatedBy,
      isoDate: ctx.isoDate ?? null,
    });
  }

  return { flights, header };
}

// =============================================================================
// LL — passenger loading list (cabin summary + staff travel queue)
// =============================================================================

const LL_ROW_RE =
  /^\s*([A-Z])\s+([A-Z]{6})\s+([A-Z0-9]{3})\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)/;

const LL_HEADER_RE = /LL\/(BA\d{4})\/(\d{2}[A-Z]{3})\/([A-Z]{3})/;

// Queue entry header: "001   05MAFOLASIRE/OLAOLU  BW69Z6   R"
const Q_HEADER_RE = /^\s*(\d{3})\s+(.+?)\s+([A-Z0-9]+)\s+([A-Z])\s*$/;
const Q_PTC_RE = /^\s*PTC\s+(SBY|BKB|ADT)\b/;
const Q_STF_RE = /OSI BA STF\s*(\S+).*?DOJ\s*(\d{2}[A-Z]{3}\d{2})/;
const Q_ROUTE_RE = /^\s*([A-Z]{6})\s*$/;
const END_OF_DISPLAY_RE = /END OF DISPLAY/;

// Subcabin (booking class letter) → main cabin mapping.
// Ported from the original HTML's cabinDisplayMap.
const SUBCABIN_TO_CABIN = {
  A: 'F', F: 'F',
  S: 'J', I: 'J', J: 'J', C: 'J', D: 'J',
  E: 'W', T: 'W', W: 'W', P: 'W',
  Q: 'M', O: 'M', G: 'M', K: 'M', L: 'M', M: 'M', N: 'M', X: 'M',
  B: 'M', H: 'M', V: 'M', Y: 'M',
};

/**
 * Parses an LL response (cabin summary + staff travel queue).
 *
 * Tolerates concatenated multi-page text — cabins dedupe by letter, queue
 * entries dedupe by line number.
 */
export function parseLL(text) {
  const lines = String(text).split(/\r?\n/);
  let flightNo = null, amadeusDate = null, queryOrigin = null;
  const cabins = [];
  const cabinsSeen = new Set();

  for (const line of lines) {
    const h = LL_HEADER_RE.exec(line);
    if (h) { [, flightNo, amadeusDate, queryOrigin] = h; continue; }
    const m = LL_ROW_RE.exec(line);
    if (!m) continue;
    const [, cabin, leg, equipment, cap, adj, uns, bc, nc] = m;
    if (cabinsSeen.has(cabin)) continue;
    cabinsSeen.add(cabin);
    cabins.push({
      cabin, leg, equipment,
      capacity: +cap, adjustments: +adj, unsold: +uns, booked: +bc, noComm: +nc,
    });
  }

  const queue = parseLLQueue(lines);
  const complete = lines.some(l => END_OF_DISPLAY_RE.test(l));
  return { flightNo, amadeusDate, queryOrigin, cabins, queue, complete };
}

/**
 * Parses just the staff-travel queue portion of LL output.
 */
export function parseLLQueue(linesOrText) {
  const lines = Array.isArray(linesOrText)
    ? linesOrText
    : String(linesOrText).split(/\r?\n/);

  // The queue starts at the first 6-letter route line that follows a cabin
  // row or LL header.
  let queueStart = -1;
  let sawCabinOrHeader = false;
  for (let i = 0; i < lines.length; i++) {
    if (LL_ROW_RE.test(lines[i]) || LL_HEADER_RE.test(lines[i])) {
      sawCabinOrHeader = true;
      continue;
    }
    if (sawCabinOrHeader && Q_ROUTE_RE.test(lines[i])) {
      queueStart = i + 1;
      break;
    }
  }
  if (queueStart < 0) return [];

  const entries = [];
  const seenByLineNo = new Set();
  let i = queueStart;

  while (i < lines.length) {
    if (END_OF_DISPLAY_RE.test(lines[i])) break;

    const hdr = Q_HEADER_RE.exec(lines[i]);
    if (!hdr) { i++; continue; }
    const [, lineNo, name, reservation, subcabin] = hdr;

    // Extent of this entry: up to the next header.
    let nextHdr = lines.length;
    for (let k = i + 1; k < lines.length; k++) {
      if (Q_HEADER_RE.test(lines[k]) || END_OF_DISPLAY_RE.test(lines[k])) {
        nextHdr = k;
        break;
      }
    }

    let ptc = null, stfCode = null, doj = null;
    for (let j = i + 1; j < nextHdr; j++) {
      if (!ptc) {
        const mp = Q_PTC_RE.exec(lines[j]);
        if (mp) ptc = mp[1];
      }
      if (!stfCode) {
        const ms = Q_STF_RE.exec(lines[j]);
        if (ms) { stfCode = ms[1]; doj = ms[2]; }
      }
      if (ptc && stfCode) break;
    }

    i = nextHdr;

    if (!ptc || !stfCode) continue;
    if (seenByLineNo.has(lineNo)) continue;
    seenByLineNo.add(lineNo);

    const head = stfCode.split('/')[0].trim();
    const bm = /^(\d+)([A-Z])?$/i.exec(head);
    const stfBucketNum = bm ? parseInt(bm[1], 10) : null;
    const stfBucketLetter = bm && bm[2] ? bm[2].toUpperCase() : null;

    const tail = (stfCode.split('/')[1] || '').trim();
    const cm = /^([FJM])(\d+)?/i.exec(tail);
    const stfClassPref = cm ? cm[1].toUpperCase() : null;
    const stfClassPrio = cm && cm[2] ? parseInt(cm[2], 10) : null;

    entries.push({
      lineNo,
      name: name.trim(),
      reservation,
      subcabin,
      cabin: SUBCABIN_TO_CABIN[subcabin] ?? null,
      ptc,
      stfCode,
      stfBucketNum,
      stfBucketLetter,
      stfClassPref,
      stfClassPrio,
      doj,
    });
  }

  return entries;
}

// =============================================================================
// Queue sorting (BA priority rules — ported from the original HTML)
// =============================================================================

const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

function parseDoj(s) {
  if (!s) return 0;
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/i.exec(s);
  if (!m) return 0;
  const d = +m[1];
  const month = MONTHS[m[2].toUpperCase()];
  const y2 = +m[3];
  const y = y2 <= 70 ? 2000 + y2 : 1900 + y2;
  return Date.UTC(y, month, d);
}

/**
 * Where would a given STF code + DOJ sit in this queue, using the same
 * priority rules? Returns a 1-based position. The queue passed in should
 * already be sorted by `sortQueueByPriority`.
 *
 * @param {Array} sortedQueue
 * @param {string} stfCode  e.g. "53B/J45"
 * @param {string} doj      e.g. "15JUN18"
 * @returns {{ position: number, aheadOf: number, queueSize: number }}
 */
export function computePositionForStf(sortedQueue, stfCode, doj) {
  if (!stfCode) return null;

  const head = stfCode.split('/')[0].trim();
  const bm = /^(\d+)([A-Z])?$/i.exec(head);
  const myBucketNum = bm ? parseInt(bm[1], 10) : Infinity;
  const myBucketLetter = bm && bm[2] ? bm[2].toUpperCase() : null;
  const myDojTs = parseDoj(doj);

  let aheadCount = 0;
  for (const entry of sortedQueue) {
    const eb = entry.stfBucketNum ?? Infinity;
    if (eb < myBucketNum) { aheadCount++; continue; }
    if (eb > myBucketNum) break;
    const al = entry.stfBucketLetter ? entry.stfBucketLetter.charCodeAt(0) : -1;
    const bl = myBucketLetter ? myBucketLetter.charCodeAt(0) : -1;
    if (al < bl) { aheadCount++; continue; }
    if (al > bl) break;
    if (parseDoj(entry.doj) < myDojTs) { aheadCount++; continue; }
    break;
  }

  return {
    position: aheadCount + 1,
    aheadOf: sortedQueue.length - aheadCount,
    queueSize: sortedQueue.length,
  };
}

/**
 * Sorts a queue in BA staff-travel priority order:
 *   1. STF bucket number ascending (lower = higher priority).
 *   2. STF bucket letter ascending (absent = best).
 *   3. DOJ ascending (longer service = higher priority).
 *
 * Mutates and returns the input array; also stamps `position` on each entry.
 */
export function sortQueueByPriority(queue) {
  queue.sort((a, b) => {
    const an = a.stfBucketNum ?? Infinity;
    const bn = b.stfBucketNum ?? Infinity;
    if (an !== bn) return an - bn;
    const al = a.stfBucketLetter ? a.stfBucketLetter.charCodeAt(0) : -1;
    const bl = b.stfBucketLetter ? b.stfBucketLetter.charCodeAt(0) : -1;
    if (al !== bl) return al - bl;
    return parseDoj(a.doj) - parseDoj(b.doj);
  });
  queue.forEach((q, idx) => { q.position = idx + 1; });
  return queue;
}
