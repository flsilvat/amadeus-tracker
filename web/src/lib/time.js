// =============================================================================
// Flight timing — derive duration + arrival day-offset from local dep/arr times.
//
// The backend stores dep/arr in LOCAL time and does not store a duration, so a
// naive clock subtraction is wrong across time zones. We resolve each local
// wall-clock time to a real UTC instant using the airport's IANA zone (DST
// correct via Intl), then take the difference.
//
// Extend AIRPORT_TZ as new stations appear. Unknown airports -> duration null
// (the card simply hides the duration rather than showing something wrong).
// =============================================================================

const AIRPORT_TZ = {
  // UK / Europe
  LHR: 'Europe/London', LGW: 'Europe/London', LCY: 'Europe/London', LTN: 'Europe/London',
  CDG: 'Europe/Paris', FRA: 'Europe/Berlin', MUC: 'Europe/Berlin', MAD: 'Europe/Madrid',
  BCN: 'Europe/Madrid', FCO: 'Europe/Rome', MXP: 'Europe/Rome', AMS: 'Europe/Amsterdam',
  DUB: 'Europe/Dublin', LIS: 'Europe/Lisbon', ZRH: 'Europe/Zurich', VIE: 'Europe/Vienna',
  CPH: 'Europe/Copenhagen', ARN: 'Europe/Stockholm', OSL: 'Europe/Oslo', HEL: 'Europe/Helsinki',
  ATH: 'Europe/Athens', IST: 'Europe/Istanbul',
  // North America
  SEA: 'America/Los_Angeles', SFO: 'America/Los_Angeles', LAX: 'America/Los_Angeles',
  SAN: 'America/Los_Angeles', LAS: 'America/Los_Angeles', PDX: 'America/Los_Angeles',
  JFK: 'America/New_York', EWR: 'America/New_York', BOS: 'America/New_York',
  IAD: 'America/New_York', PHL: 'America/New_York', MIA: 'America/New_York', ATL: 'America/New_York',
  ORD: 'America/Chicago', DFW: 'America/Chicago', IAH: 'America/Chicago', AUS: 'America/Chicago',
  DEN: 'America/Denver', PHX: 'America/Phoenix',
  YVR: 'America/Vancouver', YYZ: 'America/Toronto', YUL: 'America/Toronto',
  // Middle East / Asia / Pacific
  DXB: 'Asia/Dubai', AUH: 'Asia/Dubai', DOH: 'Asia/Qatar', SIN: 'Asia/Singapore',
  HKG: 'Asia/Hong_Kong', BKK: 'Asia/Bangkok', NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo',
  ICN: 'Asia/Seoul', PEK: 'Asia/Shanghai', PVG: 'Asia/Shanghai', DEL: 'Asia/Kolkata',
  BOM: 'Asia/Kolkata', SYD: 'Australia/Sydney', MEL: 'Australia/Melbourne',
  // Africa / South America
  JNB: 'Africa/Johannesburg', CPT: 'Africa/Johannesburg', CAI: 'Africa/Cairo',
  GRU: 'America/Sao_Paulo', GIG: 'America/Sao_Paulo', EZE: 'America/Argentina/Buenos_Aires',
};

// Real UTC instant (ms) for a wall-clock time in a given IANA zone, DST correct.
function wallToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = dtf.formatToParts(new Date(guess)).reduce((a, x) => ((a[x.type] = x.value), a), {});
  const asTz = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const offset = asTz - guess; // zone is ahead of UTC by this many ms at that instant
  return guess - offset;
}

// { durationMin, arrDayOffset } from a flight's origin/destination + local times.
export function flightTiming(flight) {
  const tzO = AIRPORT_TZ[flight.origin];
  const tzD = AIRPORT_TZ[flight.destination];
  if (!tzO || !tzD || !flight.isoDate || !flight.depTime || !flight.arrTime) {
    return { durationMin: null, arrDayOffset: 0 };
  }
  const [y, mo, d] = flight.isoDate.split('-').map(Number);
  const [dh, dm] = flight.depTime.split(':').map(Number);
  const [ah, am] = flight.arrTime.split(':').map(Number);
  const depUtc = wallToUtc(y, mo, d, dh, dm, tzO);
  // Try arrival on the same day, then +1, +2; accept the first plausible duration.
  for (const off of [0, 1, 2]) {
    const base = new Date(Date.UTC(y, mo - 1, d + off));
    const arrUtc = wallToUtc(
      base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), ah, am, tzD
    );
    const dur = Math.round((arrUtc - depUtc) / 60000);
    if (dur > 0 && dur < 20 * 60) return { durationMin: dur, arrDayOffset: off };
  }
  return { durationMin: null, arrDayOffset: 0 };
}
