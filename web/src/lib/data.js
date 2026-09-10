import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query,
  serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { CABIN_MAP } from './odds.js';
import { flightTiming } from './time.js';
import { LOCAL_MODE, localFetch, pollLocal } from './local.js';

// ---------------------------------------------------------------------------
// Curated groups in LOCAL_MODE live in the local service's SQLite database
// (GET/POST/PUT/DELETE /flight-groups), so every browser on this PC sees the
// same list. An older build kept them in this browser's localStorage under
// the key below; the first poll moves any such groups into the service.
// ---------------------------------------------------------------------------

const LEGACY_LOCAL_FLIGHT_GROUPS_KEY = 'amadeus-tracker-flight-groups';
const localFlightGroupListeners = new Set();
let legacyGroupsMigrated = false;

function mapLocalFlightGroup(row) {
  return {
    id: row.id,
    name: row.name,
    flights: row.flights || [],
    myStfCode: row.my_stf_code || '',
    myDoj: row.my_doj || '',
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Fetch the current list and push it to every subscriber. Called by the poll
// and right after each mutation, so the UI updates without waiting for the
// next poll.
async function loadLocalFlightGroups() {
  const groups = (await localFetch('/flight-groups')).map(mapLocalFlightGroup);
  localFlightGroupListeners.forEach((cb) => cb(groups));
  return groups;
}

async function updateLocalFlightGroup(id, patch) {
  await localFetch(`/flight-groups/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
  await loadLocalFlightGroups();
}

async function migrateLegacyLocalFlightGroups() {
  if (legacyGroupsMigrated) return;
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_LOCAL_FLIGHT_GROUPS_KEY) || '[]'); }
  catch { legacy = []; }
  if (!Array.isArray(legacy)) legacy = [];
  const valid = legacy.filter((g) => g && g.id && g.name);
  if (valid.length) {
    await localFetch('/flight-groups/import', { method: 'POST', body: JSON.stringify({ groups: valid }) });
    // Keep a backup copy in the browser in case anything needs recovering.
    localStorage.setItem(`${LEGACY_LOCAL_FLIGHT_GROUPS_KEY}.migrated`, JSON.stringify(legacy));
  }
  localStorage.removeItem(LEGACY_LOCAL_FLIGHT_GROUPS_KEY);
  legacyGroupsMigrated = true;
}

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
    active: flightDoc.active !== false,
    cabins: latestObs ? mapCabins(latestObs.cabins) : {},
    queue: latestObs ? latestObs.queue || [] : [],
    observedAt: latestObs ? latestObs.queryTime : null,
    daysToDeparture: latestObs ? latestObs.daysToDeparture : null,
  };
}

function buildLocalFlight(row) {
  const cabins = {};
  for (const [key, prefix] of [['F', 'f'], ['J', 'j'], ['W', 'w'], ['M', 'm']]) {
    if (row[`${prefix}_capacity`] != null || row[`${prefix}_booked`] != null) {
      cabins[key] = { capacity: row[`${prefix}_capacity`], booked: row[`${prefix}_booked`], adj: 0 };
    }
  }
  return buildFlight({
    flightNo: row.flight_no,
    isoDate: row.iso_date,
    origin: row.origin,
    destination: row.destination,
    direction: row.direction,
    depTime: row.dep_time,
    arrTime: row.arr_time,
    equipment: row.equipment,
    active: row.active !== 0,
  }, row.query_time ? {
    cabins,
    queue: (row.queue || []).map((q) => ({
      lineNo: q.line_no,
      name: q.passenger_name,
      reservation: q.reservation,
      subcabin: q.subcabin,
      cabin: q.cabin,
      ptc: q.ptc,
      stfCode: q.stf_code,
      stfBucketNum: q.stf_bucket_num,
      stfBucketLetter: q.stf_bucket_letter,
      stfClassPref: q.stf_class_pref,
      stfClassPrio: q.stf_class_prio,
      doj: q.doj,
      position: q.position,
    })),
    queryTime: row.query_time,
    daysToDeparture: row.days_to_departure,
  } : null);
}

function mapLocalGroup(row) {
  return {
    id: row.id,
    name: row.name,
    outbound: row.outbound_origin ? {
      origin: row.outbound_origin,
      destination: row.outbound_destination,
      date: row.outbound_date,
    } : null,
    inbound: row.inbound_origin ? {
      origin: row.inbound_origin,
      destination: row.inbound_destination,
      date: row.inbound_date,
    } : null,
    myStfCode: row.my_stf_code,
    myDoj: row.my_doj,
    createdAt: row.created_at,
    active: row.active !== 0,
  };
}

// Subscribe to trips. We read all group docs and filter client-side so trips
// created before the `active` field existed (older groups) still show — only
// explicitly archived ones (active === false) are hidden.
export function subscribeGroups(cb, onError) {
  if (LOCAL_MODE) {
    return pollLocal(() => localFetch('/groups'), (groups) => {
      cb(groups.map(mapLocalGroup).filter((g) => g.active));
    }, onError);
  }
  const q = query(collection(db, 'groups'));
  // createdAt is an ISO string mirrored from the service; tolerate Firestore
  // Timestamps and missing values (missing -> 0 -> sorts to the bottom).
  const ts = (g) => {
    const c = g.createdAt;
    if (!c) return 0;
    if (typeof c === 'string') return Date.parse(c) || 0;
    return c.toMillis ? c.toMillis() : 0;
  };
  return onSnapshot(q, (snap) => {
    const groups = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((g) => g.active !== false);
    groups.sort((a, b) => ts(b) - ts(a)); // newest first, oldest at the bottom
    cb(groups);
  }, onError);
}

// Archive a trip immediately (UI-side). The group doc flips active=false so it
// disappears from every device right away; an archiveGroup command should also
// be queued so the work PC's local DB syncs and stops refreshing it.
export function archiveGroupNow(groupId) {
  if (LOCAL_MODE) return localFetch(`/groups/${encodeURIComponent(groupId)}/archive`, { method: 'POST' });
  return updateDoc(doc(db, 'groups', groupId), { active: false });
}

// Subscribe to the flights of one group, each merged with its latest
// observation. cb receives an array of card view-models.
//
// We read all observations for the group (single equality filter -> no
// composite index needed) and reduce to the latest per flight client-side.
export function subscribeGroupFlights(groupId, cb, onError, { includeHidden = false } = {}) {
  if (LOCAL_MODE) {
    return pollLocal(
      () => localFetch(`/groups/${encodeURIComponent(groupId)}/latest`),
      (rows) => cb(rows.filter((row) => includeHidden || row.active !== 0).map(buildLocalFlight)),
      onError
    );
  }
  const flightsQ = query(collection(db, 'flights'), where('groupId', '==', groupId));
  const obsQ = query(collection(db, 'observations'), where('groupId', '==', groupId));

  let flightDocs = [];
  let latestByFlight = {}; // flightKey -> obs

  const emit = () => {
    const cards = flightDocs
      .filter((f) => includeHidden || f.active !== false)
      .map((f) => {
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

// Hide / restore a single flight immediately (UI-side). The flight doc flips
// active so it vanishes from every device at once; an archiveFlight command
// should also be queued so the work PC stops refreshing it.
export function archiveFlightNow(flightNo, isoDate) {
  if (LOCAL_MODE) return localFetch('/flights/archive', { method: 'POST', body: JSON.stringify({ flightNo, isoDate }) });
  return updateDoc(doc(db, 'flights', `${flightNo}_${isoDate}`), { active: false });
}
export function restoreFlightNow(flightNo, isoDate) {
  if (LOCAL_MODE) return localFetch('/flights/restore', { method: 'POST', body: JSON.stringify({ flightNo, isoDate }) });
  return updateDoc(doc(db, 'flights', `${flightNo}_${isoDate}`), { active: true });
}

// ---------------------------------------------------------------------------
// Custom groups — curated, cross-trip views. Firestore-only (`/flightGroups`).
// A group is just an ordered list of live flight references.
//   flights: [ { flightNo, isoDate, origin, destination } ]
// ---------------------------------------------------------------------------

export function subscribeFlightGroups(cb, onError) {
  if (LOCAL_MODE) {
    localFlightGroupListeners.add(cb);
    const stop = pollLocal(async () => {
      await migrateLegacyLocalFlightGroups();
      await loadLocalFlightGroups();
    }, () => {}, onError);
    return () => { localFlightGroupListeners.delete(cb); stop(); };
  }
  return onSnapshot(query(collection(db, 'flightGroups')), (snap) => {
    const groups = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ts = (g) => (g.createdAt && g.createdAt.toMillis ? g.createdAt.toMillis() : 0);
    groups.sort((a, b) => ts(a) - ts(b)); // oldest first (stable tab order)
    cb(groups);
  }, onError);
}

export async function createFlightGroup(name, uid) {
  if (LOCAL_MODE) {
    const created = await localFetch('/flight-groups', {
      method: 'POST',
      body: JSON.stringify({ name: name || 'My journey', createdBy: uid || null, flights: [] }),
    });
    await loadLocalFlightGroups();
    return created.id;
  }
  const ref = await addDoc(collection(db, 'flightGroups'), {
    name: name || 'My journey',
    createdBy: uid || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    flights: [],
  });
  return ref.id;
}

export function renameFlightGroup(id, name) {
  if (LOCAL_MODE) return updateLocalFlightGroup(id, { name });
  return updateDoc(doc(db, 'flightGroups', id), { name, updatedAt: serverTimestamp() });
}

export async function deleteFlightGroup(id) {
  if (LOCAL_MODE) {
    await localFetch(`/flight-groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await loadLocalFlightGroups();
    return;
  }
  return deleteDoc(doc(db, 'flightGroups', id));
}

const refKey = (r) => `${r.flightNo}_${r.isoDate}`;

export function setFlightGroupFlights(id, flights) {
  if (LOCAL_MODE) return updateLocalFlightGroup(id, { flights });
  return updateDoc(doc(db, 'flightGroups', id), { flights, updatedAt: serverTimestamp() });
}

export function setFlightGroupDetails(id, details) {
  if (LOCAL_MODE) return updateLocalFlightGroup(id, details);
  return updateDoc(doc(db, 'flightGroups', id), { ...details, updatedAt: serverTimestamp() });
}

export function addFlightToGroup(group, flight) {
  const ref = { flightNo: flight.flightNo, isoDate: flight.isoDate, origin: flight.origin, destination: flight.destination };
  const exists = (group.flights || []).some((r) => refKey(r) === refKey(ref));
  const flights = exists ? group.flights : [...(group.flights || []), ref];
  return setFlightGroupFlights(group.id, flights);
}

export function removeFlightFromGroup(group, flight) {
  const flights = (group.flights || []).filter((r) => refKey(r) !== `${flight.flightNo}_${flight.isoDate}`);
  return setFlightGroupFlights(group.id, flights);
}

// Render a custom group: resolve each ref against the LIVE flights +
// latest observations across ALL trips. Returns card view-models (same shape
// as subscribeGroupFlights) in the group's stored order.
export function subscribeCustomGroupFlights(group, cb, onError) {
  if (LOCAL_MODE) {
    return pollLocal(async () => {
      // One request for every stored flight (all trips, archived included).
      const rows = await localFetch('/flights/latest');
      // The same flight can belong to several trips; keep the copy with the
      // freshest observation, and prefer a non-hidden copy on a tie.
      const flightByKey = {};
      rows.forEach((row) => {
        const key = `${row.flight_no}_${row.iso_date}`;
        const prev = flightByKey[key];
        if (!prev) { flightByKey[key] = row; return; }
        const t = String(row.query_time || '');
        const tPrev = String(prev.query_time || '');
        if (t > tPrev || (t === tPrev && row.active !== 0 && prev.active === 0)) flightByKey[key] = row;
      });
      return (group.flights || []).map((ref) => {
        const row = flightByKey[`${ref.flightNo}_${ref.isoDate}`];
        // Fall back to the stored ref so the card still renders (without
        // loads) instead of vanishing — same as the Firestore path below.
        return row ? buildLocalFlight(row) : buildFlight({ ...ref, direction: undefined }, null);
      });
    }, cb, onError);
  }
  const flightsQ = query(collection(db, 'flights'));
  const obsQ = query(collection(db, 'observations'));

  let flightByKey = {};
  let latestByFlight = {};
  const refs = () => group.flights || [];

  const emit = () => {
    const cards = refs()
      .map((r) => {
        const key = `${r.flightNo}_${r.isoDate}`;
        const f = flightByKey[key];
        // Fall back to the stored ref if the flight doc isn't loaded yet, so
        // the card still renders (without loads) instead of vanishing.
        const flightDoc = f || { ...r, direction: undefined };
        return buildFlight(flightDoc, latestByFlight[key] || null);
      });
    cb(cards);
  };

  const unsubFlights = onSnapshot(flightsQ, (snap) => {
    const byKey = {};
    snap.docs.forEach((d) => { const f = d.data(); byKey[`${f.flightNo}_${f.isoDate}`] = f; });
    flightByKey = byKey;
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
