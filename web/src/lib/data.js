import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase.js';
import { CABIN_MAP } from './odds.js';
import { flightTiming } from './time.js';

// ---------------------------------------------------------------------------
// Mappers: backend Firestore docs -> the view-model the cards expect.
//
//   observation.cabins[c] = { capacity, booked, unsold, adjustments, noComm }
//   -> card cabin          = { capacity, booked, adj }
// ---------------------------------------------------------------------------

function mapCabins(cabinsObj = {}) {
  const out = {};
  for (const c of ['F', 'J', 'W', 'M']) {
    const v = cabinsObj[c];
    if (v) out[c] = { capacity: v.capacity, booked: v.booked, adj: v.adjustments || 0 };
  }
  return out;
}

function obsMillis(o) {
  const t = o.createdAt;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  // fall back to queryTime string ordering when serverTimestamp is still pending
  return 0;
}

// Merge a flight doc with its latest observation into one card view-model.
function buildFlight(flightDoc, latestObs) {
  // Backend doesn't store duration/day-offset; derive from local times + tz.
  const timing = flightDoc.durationMin != null
    ? { durationMin: flightDoc.durationMin, arrDayOffset: flightDoc.arrDayOffset ?? 0 }
    : flightTiming(flightDoc);
  return {
    flightNo: flightDoc.flightNo,
    isoDate: flightDoc.isoDate,
    origin: flightDoc.origin,
    destination: flightDoc.destination,
    direction: flightDoc.direction,
    depTime: flightDoc.depTime,
    arrTime: flightDoc.arrTime,
    equipment: flightDoc.equipment,
    durationMin: timing.durationMin,
    arrDayOffset: timing.arrDayOffset,
    cabins: latestObs ? mapCabins(latestObs.cabins) : {},
    queue: latestObs ? latestObs.queue || [] : [],
    observedAt: latestObs ? latestObs.queryTime : null,
    daysToDeparture: latestObs ? latestObs.daysToDeparture : null,
  };
}

// Subscribe to all active groups. cb receives an array of group docs.
export function subscribeGroups(cb, onError) {
  const q = query(collection(db, 'groups'), where('active', '==', true));
  return onSnapshot(q, (snap) => {
    const groups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    groups.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    cb(groups);
  }, onError);
}

// Subscribe to the flights of one group, each merged with its latest
// observation. cb receives an array of card view-models.
//
// We read all observations for the group (single equality filter -> no
// composite index needed) and reduce to the latest per flight client-side.
export function subscribeGroupFlights(groupId, cb, onError) {
  const flightsQ = query(collection(db, 'flights'), where('groupId', '==', groupId));
  const obsQ = query(collection(db, 'observations'), where('groupId', '==', groupId));

  let flightDocs = [];
  let latestByFlight = {}; // flightKey -> obs

  const emit = () => {
    const cards = flightDocs.map((f) => {
      const key = `${f.flightNo}_${f.isoDate}`;
      return buildFlight(f, latestByFlight[key] || null);
    });
    cb(cards);
  };

  const unsubFlights = onSnapshot(flightsQ, (snap) => {
    flightDocs = snap.docs.map((d) => d.data());
    emit();
  }, onError);

  const unsubObs = onSnapshot(obsQ, (snap) => {
    const latest = {};
    snap.docs.forEach((d) => {
      const o = d.data();
      const key = `${o.flightNo}_${o.isoDate}`;
      const prev = latest[key];
      if (!prev || obsMillis(o) > obsMillis(prev) ||
          (obsMillis(o) === obsMillis(prev) && String(o.queryTime) > String(prev.queryTime))) {
        latest[key] = o;
      }
    });
    latestByFlight = latest;
    emit();
  }, onError);

  return () => { unsubFlights(); unsubObs(); };
}

// ---------------------------------------------------------------------------
// Mock data for ?demo=1 — shaped identically to the mapped live view-model.
// ---------------------------------------------------------------------------

const cab = (capacity, booked, adj = 0) => ({ capacity, booked, adj });
const pax = (lineNo, name, reservation, subcabin, ptc, stfCode, doj) => ({
  lineNo, name, reservation, subcabin, cabin: CABIN_MAP[subcabin] || 'M', ptc, stfCode, doj,
});

export const MOCK_GROUP = {
  id: 'trip-sea-jul-26',
  name: 'Seattle · late July',
  myStfCode: '21/J19',
  myDoj: '15JUN18',
};

export const MOCK_FLIGHTS = [
  {
    flightNo: 'BA0047', isoDate: '2026-07-15', origin: 'LHR', destination: 'SEA',
    direction: 'outbound', depTime: '15:05', arrTime: '17:00', arrDayOffset: 0, durationMin: 595, equipment: '388',
    cabins: { F: cab(14, 8, -2), J: cab(97, 70), W: cab(55, 40), M: cab(303, 250) },
    queue: [
      pax('001', 'BLAKE/TOM', 'AB12CD', 'J', 'SBY', '18/J05', '03FEB12'),
      pax('002', 'REYES/ANA', 'EF34GH', 'C', 'SBY', '20/F10', '21NOV15'),
      pax('003', 'OKORO/JM', 'IJ56KL', 'D', 'SBY', '21/J08', '01JAN17'),
      pax('004', 'PATEL/SU', 'MN78OP', 'Y', 'SBY', '22/M30', '10MAR20'),
      pax('005', 'WONG/LI', 'QR90ST', 'J', 'SBY', '23/J12', '15JUN21'),
    ],
  },
  {
    flightNo: 'BA0049', isoDate: '2026-07-15', origin: 'LHR', destination: 'SEA',
    direction: 'outbound', depTime: '19:40', arrTime: '21:35', arrDayOffset: 0, durationMin: 590, equipment: '789',
    cabins: { F: cab(8, 8), J: cab(48, 46), W: cab(39, 34), M: cab(127, 30) },
    queue: [
      pax('001', 'HALL/RJ', 'UV11AA', 'J', 'SBY', '12/J03', '08AUG09'),
      pax('002', 'DIAZ/MC', 'WX22BB', 'C', 'SBY', '15/J07', '19SEP11'),
      pax('003', 'FROST/KE', 'YZ33CC', 'D', 'SBY', '18/J11', '27JUL14'),
      pax('004', 'SOLE/AB', 'AB44DD', 'Y', 'SBY', '19/M02', '30JAN16'),
      pax('005', 'NAIR/PV', 'CD55EE', 'I', 'SBY', '20/J22', '12DEC18'),
    ],
  },
  {
    flightNo: 'BA0048', isoDate: '2026-07-29', origin: 'SEA', destination: 'LHR',
    direction: 'inbound', depTime: '18:30', arrTime: '12:25', arrDayOffset: 1, durationMin: 540, equipment: '388',
    cabins: { F: cab(14, 14), J: cab(97, 97, -3), W: cab(55, 54), M: cab(303, 301) },
    queue: [
      pax('001', 'GREEN/AL', 'EE66FF', 'J', 'SBY', '08/J01', '01JAN05'),
      pax('002', 'SHAH/RI', 'GG77HH', 'C', 'SBY', '11/J04', '14FEB08'),
      pax('003', 'LOWE/TS', 'II88JJ', 'D', 'SBY', '14/J09', '22JUN10'),
      pax('004', 'KAUR/MN', 'KK99LL', 'Y', 'SBY', '16/M12', '30SEP13'),
      pax('005', 'ABEL/JO', 'MM00NN', 'I', 'SBY', '18/J15', '11NOV15'),
      pax('006', 'VEGA/CL', 'OO11PP', 'J', 'SBY', '19/J20', '15JUN17'),
      pax('007', 'TODD/BE', 'QQ22RR', 'S', 'SBY', '20/J03', '02MAR19'),
      pax('008', 'YUSUF/HA', 'SS33TT', 'M', 'SBY', '20/M40', '08AUG20'),
    ],
  },
  {
    flightNo: 'BA0050', isoDate: '2026-07-29', origin: 'SEA', destination: 'LHR',
    direction: 'inbound', depTime: '20:55', arrTime: '14:50', arrDayOffset: 1, durationMin: 545, equipment: '781',
    cabins: { F: cab(8, 3, -1), J: cab(56, 30), W: cab(56, 40), M: cab(99, 60) },
    queue: [
      pax('001', 'MOSS/DK', 'UU44VV', 'J', 'SBY', '19/J05', '19SEP16'),
      pax('002', 'BIRD/AN', 'WW55XX', 'C', 'SBY', '20/F08', '27JUL17'),
    ],
  },
];

export const isDemo = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
