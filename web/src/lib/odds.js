// =============================================================================
// Odds engine — pure logic, no React. Ported from the validated prototype.
//
// Model: clearance happens in a single pass in queue-priority order. Each
// person ahead of you takes their entitled cabin (downgrading if it's full),
// then we look at what cabin is left when your turn comes.
// =============================================================================

export const CABIN_MAP = {
  A: 'F', F: 'F',
  S: 'J', I: 'J', J: 'J', C: 'J', D: 'J',
  E: 'W', T: 'W', W: 'W', P: 'W',
  Q: 'M', O: 'M', G: 'M', K: 'M', L: 'M', M: 'M', N: 'M', X: 'M',
  B: 'M', H: 'M', V: 'M', Y: 'M',
};

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

export function parseDoj(s) {
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/i.exec(s || '');
  if (!m) return 0;
  const y2 = +m[3];
  const y = y2 <= 70 ? 2000 + y2 : 1900 + y2;
  return Date.UTC(y, MONTHS[m[2].toUpperCase()], +m[1]);
}

export function bucketParts(stf) {
  const head = String(stf || '').split('/')[0].trim();
  const m = head.match(/^(\d+)([A-Z])?$/i);
  return { num: m ? +m[1] : NaN, letter: m && m[2] ? m[2].toUpperCase() : '' };
}

export function classPref(stf) {
  const p = String(stf || '').split('/');
  if (p.length < 2) return 'M';
  const m = p[1].match(/^([FJM])/i);
  return m ? m[1].toUpperCase() : 'M';
}

const letterOrder = (l) => (l ? l.charCodeAt(0) : -1);

function isBefore(pP, pD, fP, fD) {
  if (pP.num !== fP.num) return pP.num < fP.num;
  const a = letterOrder(pP.letter), b = letterOrder(fP.letter);
  if (a !== b) return a < b;
  return pD < fD;
}

export function paxKey(p) {
  return [p.name, p.reservation, p.stfCode].join('|');
}

function availByCabin(cabins) {
  const a = { F: 0, J: 0, W: 0, M: 0 };
  ['F', 'J', 'W', 'M'].forEach((c) => {
    if (cabins[c]) a[c] += cabins[c].capacity - cabins[c].booked;
  });
  a.total = a.F + a.J + a.W + a.M;
  return a;
}

// Oversold paid pax cascade upward M->W->J->F before staff get premium.
function cascadeOversell(av) {
  const eff = { ...av };
  const order = ['M', 'W', 'J', 'F'];
  for (let i = 0; i < order.length - 1; i++) {
    if (eff[order[i]] < 0) {
      const d = -eff[order[i]];
      eff[order[i]] = 0;
      eff[order[i + 1]] -= d;
    }
  }
  eff.total = av.total;
  return eff;
}

export function seatPools(cabins) {
  const raw = availByCabin(cabins);
  const eff = cascadeOversell(raw);
  const F = Math.max(0, eff.F), J = Math.max(0, eff.J), W = Math.max(0, eff.W), M = Math.max(0, eff.M);
  return { F, J, W, M, premiumTotal: F + J, total: Math.max(0, raw.total), raw };
}

export function sortedQueue(queue) {
  return [...queue].sort((a, b) => {
    const A = bucketParts(a.stfCode), B = bucketParts(b.stfCode);
    if (A.num !== B.num) return A.num - B.num;
    const la = letterOrder(A.letter), lb = letterOrder(B.letter);
    if (la !== lb) return la - lb;
    return parseDoj(a.doj) - parseDoj(b.doj);
  });
}

const DOWNGRADE = { F: ['F', 'J', 'W', 'M'], J: ['J', 'W', 'M'], M: ['M'] };

/**
 * @param flight       { cabins, queue }
 * @param myCode       e.g. "21/J19"
 * @param myDoj        e.g. "15JUN18"
 * @param confirmedSet Set of paxKey(p) marked confirmed for THIS flight
 * @returns { queue, badge, dividerIndex, color, seats, myCabin }
 */
export function computeOdds(flight, myCode, myDoj, confirmedSet) {
  const queue = sortedQueue(flight.queue || []);
  const pools = seatPools(flight.cabins || {});
  const base = { queue, badge: null, dividerIndex: queue.length, color: 'neutral', seats: pools, myCabin: null, meKeys: new Set() };
  if (!myCode) return base;
  const fParts = bucketParts(myCode);
  if (!Number.isFinite(fParts.num)) return base;
  const fd = parseDoj(myDoj);

  // Exact matches: pax whose pass code AND DOJ equal the trip's are YOU (and
  // any companions on the same booking). When present, the queue already
  // contains you — so the divider goes BELOW the last match, the badge counts
  // people ahead INCLUDING your party, and the clearance walk seats the real
  // you instead of inserting a virtual entry (which would double-count you).
  const norm = (s) => String(s || '').trim().toUpperCase();
  const meKeys = new Set();
  let lastMatchIdx = -1;
  if (myDoj) {
    queue.forEach((p, idx) => {
      if (norm(p.stfCode) === norm(myCode) && norm(p.doj) === norm(myDoj)) {
        meKeys.add(paxKey(p));
        lastMatchIdx = idx;
      }
    });
  }
  const matched = lastMatchIdx >= 0;

  let badge = 0;
  const ahead = [];
  let dividerIndex = queue.length;

  if (matched) {
    dividerIndex = lastMatchIdx + 1;
    for (let i = 0; i <= lastMatchIdx; i++) {
      const q = queue[i];
      if (!confirmedSet.has(paxKey(q))) { badge++; ahead.push(q); }
    }
  } else {
    queue.forEach((q, idx) => {
      const pParts = bucketParts(q.stfCode);
      if (!Number.isFinite(pParts.num)) return;
      if (isBefore(pParts, parseDoj(q.doj), fParts, fd)) {
        if (!confirmedSet.has(paxKey(q))) { badge++; ahead.push(q); }
      } else if (dividerIndex === queue.length) {
        dividerIndex = idx;
      }
    });
  }

  const p = { F: pools.F, J: pools.J, W: pools.W, M: pools.M };
  const take = (pref) => {
    for (const c of (DOWNGRADE[pref] || ['M'])) { if (p[c] > 0) { p[c]--; return c; } }
    return null;
  };

  let myCabin = null;
  if (matched) {
    // Seat everyone up to and including your party, in order. Your outcome is
    // the cabin your LAST party member gets (the binding constraint).
    let sawUnconfirmedMe = false;
    ahead.forEach((person) => {
      const c = take(classPref(person.stfCode));
      if (meKeys.has(paxKey(person))) { sawUnconfirmedMe = true; myCabin = c; }
    });
    if (!sawUnconfirmedMe) {
      // Whole party marked confirmed — show what's left at your priority point.
      for (const c of (DOWNGRADE[classPref(myCode)] || ['M'])) { if (p[c] > 0) { myCabin = c; break; } }
    }
  } else {
    ahead.forEach((person) => take(classPref(person.stfCode)));
    for (const c of (DOWNGRADE[classPref(myCode)] || ['M'])) { if (p[c] > 0) { myCabin = c; break; } }
  }

  let color;
  if (myCabin === 'F' || myCabin === 'J') color = 'blue';
  else if (myCabin === 'W' || myCabin === 'M') color = 'amber';
  else color = 'red';

  return { queue, badge, dividerIndex, color, seats: pools, myCabin, meKeys };
}

// ---- presentation helpers -------------------------------------------------

export const ODDS_META = {
  blue: { cls: 'odds-blue', pill: 'bg-blue-50 text-blue-700 border-blue-200' },
  amber: { cls: 'odds-amber', pill: 'bg-orange-50 text-orange-700 border-orange-200' },
  red: { cls: 'odds-red', pill: 'bg-pink-50 text-pink-700 border-pink-200' },
  neutral: { cls: 'odds-neutral', pill: 'bg-stone-100 text-stone-500 border-stone-200' },
};

export const CABIN_FULL = { F: 'First', J: 'Club', W: 'Eco+', M: 'Economy' };

export function statusLabel(color, myCabin) {
  if (color === 'blue') return (myCabin === 'F' ? 'First' : 'Club') + ' likely';
  if (color === 'amber') return 'On — ' + (CABIN_FULL[myCabin] || 'Economy');
  if (color === 'red') return 'Unlikely';
  return 'Set pass code';
}

export function statusNote(color) {
  if (color === 'blue') return 'Premium clears your position';
  if (color === 'amber') return 'Premium gone above you';
  if (color === 'red') return 'More people ahead than seats';
  return '';
}
