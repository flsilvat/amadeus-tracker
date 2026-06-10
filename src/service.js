/**
 * Higher-level operations — routes and the scheduler call into here.
 *
 * Every JFE-touching operation goes through `enqueue(...)` for serialisation.
 * Every storage write hits SQLite synchronously (source of truth), then
 * fire-and-forgets a Firestore mirror write.
 */
import { enqueue } from './queue.js';
import { runCommand, runCommandPaginated } from './amadeus/automator.js';
import { buildAN, buildLL } from './amadeus/commandBuilder.js';
import { parseAN, parseLL, sortQueueByPriority, hasConnectingItinerary } from './amadeus/parser.js';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  upsertGroup, upsertFlight, getGroup, listGroups, listFlights, insertObservation, getFlight,
  setGroupActive, findFlight, setFlightActive,
} from './storage/sqlite.js';
import {
  mirrorGroup, mirrorFlight, mirrorObservation, mirrorGroupActive, mirrorFlightActive,
} from './storage/firestore.js';

function directionFor(origin, destination) {
  if (origin === config.HOME_AIRPORT) return 'outbound';
  if (destination === config.HOME_AIRPORT) return 'inbound';
  return 'other';
}

/**
 * Create/update a group, run AN on both legs (paginated), discover BA flights.
 * Group spec now includes per-trip STF code and DOJ.
 */
export async function createOrUpdateGroupAndDiscover(groupSpec) {
  const groupRecord = {
    ...groupSpec,
    createdAt: new Date().toISOString(),
  };
  upsertGroup(groupRecord);
  mirrorGroup(groupRecord);  // fire-and-forget

  const legs = [groupSpec.outbound, groupSpec.inbound].filter(Boolean);
  const allDiscovered = [];

  for (const leg of legs) {
    const command = buildAN(leg.date, leg.origin, leg.destination);
    logger.info({ command }, 'AN command built');

    const { response, pages } = await enqueue(
      `AN ${leg.origin}→${leg.destination} ${leg.date}`,
      () => runCommandPaginated(command, {
        endMarker: /NO MORE (LATER|EARLIER) FLTS/,
        // AN lists direct flights first; once a connecting itinerary appears,
        // everything after is connections (which we discard), so stop paging.
        stopWhen: config.AN_STOP_AT_CONNECTIONS ? hasConnectingItinerary : null,
        // AN responses echo the command at the top — require it, so a copy of
        // a half-rendered/old screen is retried instead of parsed.
        expect: new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      })
    );

    const { flights } = parseAN(response, { isoDate: leg.date });
    // Three filters to get to "direct BA-operated flights on this exact leg":
    //   1. BA-operated (not codeshare with another operator)
    //   2. Origin matches the leg's requested origin (rejects connecting
    //      flights via other airports whose 1st leg happens to be BA)
    //   3. Destination matches the leg's requested destination (rejects
    //      first legs of connections that end somewhere else)
    const directBA = flights.filter(f =>
      f.isBAOperated &&
      f.origin === leg.origin.toUpperCase() &&
      f.destination === leg.destination.toUpperCase()
    );

    logger.info(
      {
        leg: `${leg.origin}-${leg.destination}`,
        pages,
        totalMatched: flights.length,
        directBA: directBA.length,
        rejected: flights.length - directBA.length,
      },
      'AN discovered'
    );

    for (const f of directBA) {
      const flightRecord = {
        groupId: groupSpec.id,
        flightNo: f.flightNo,
        isoDate: leg.date,
        origin: f.origin,
        destination: f.destination,
        direction: directionFor(f.origin, f.destination),
        depTime: f.depTime,
        arrTime: f.arrTime,
        equipment: f.equipment,
      };
      const flightId = upsertFlight(flightRecord);

      // Re-read from DB to get the canonical row shape (with snake_case fields)
      // and pass that to the Firestore mirror so both stores agree.
      const dbFlight = getFlight(flightId);
      if (dbFlight) mirrorFlight(dbFlight);

      allDiscovered.push({ ...f, isoDate: leg.date });
    }
  }

  return allDiscovered;
}

/**
 * Run LL (paginated) for every flight in a group, parse cabins + queue,
 * sort the queue, persist to SQLite, mirror to Firestore.
 */
// Refresh one flight (LL → parse → store → mirror). Returns true on success.
// `f` is a SQLite flight row. Shared by refreshGroup and refreshFlights.
async function refreshOneFlight(f, failures) {
  const command = buildLL(f.flight_no, f.iso_date, f.origin);
  logger.info({ command }, 'LL command built');
  try {
    const { response, capturedAt, pages, complete } = await enqueue(
      `LL ${f.flight_no} ${f.iso_date}`,
      () => runCommandPaginated(command, { endMarker: /END OF DISPLAY/ })
    );

    const parsed = parseLL(response);
    if (!parsed.cabins.length) {
      failures.push({ flightId: f.id, reason: 'no cabins parsed', sample: response.slice(0, 200) });
      return false;
    }

    sortQueueByPriority(parsed.queue);

    insertObservation({
      flightId: f.id,
      isoDate: f.iso_date,
      queryTime: capturedAt,
      cabins: parsed.cabins,
      queueEntries: parsed.queue,
      rawResponse: response,
    });

    const daysToDeparture =
      (new Date(f.iso_date + 'T00:00:00Z').getTime() - new Date(capturedAt).getTime()) /
      (1000 * 60 * 60 * 24);
    mirrorObservation({
      flightNo: f.flight_no,
      isoDate: f.iso_date,
      origin: f.origin,
      destination: f.destination,
      queryTime: capturedAt,
      daysToDeparture,
      cabins: parsed.cabins,
      queue: parsed.queue,
      groupId: f.group_id,
      flightId: f.id,
    });

    logger.info(
      { flight: f.flight_no, pages, complete, queueSize: parsed.queue.length },
      'LL stored + mirrored'
    );
    return true;
  } catch (err) {
    logger.error({ flight: f.flight_no, err: err.message }, 'LL failed');
    failures.push({ flightId: f.id, reason: err.message });
    return false;
  }
}

export async function refreshGroup(groupId) {
  const group = getGroup(groupId);
  if (!group) throw new Error(`Unknown group: ${groupId}`);

  const flights = listFlights(groupId); // active only — hidden flights skipped
  if (!flights.length) {
    logger.warn({ groupId }, 'refreshGroup: no flights to refresh');
    return { groupId, refreshed: 0 };
  }

  let refreshed = 0;
  const failures = [];
  for (const f of flights) {
    if (await refreshOneFlight(f, failures)) refreshed++;
  }
  return { groupId, refreshed, failures, total: flights.length };
}

// Refresh a specific set of flights (used by custom Groups, which span trips).
// refs: [{ flightNo, isoDate, origin? }]. Resolves each to its SQLite row.
export async function refreshFlights(refs = []) {
  let refreshed = 0;
  const failures = [];
  for (const ref of refs) {
    const f = findFlight({ flightNo: ref.flightNo, isoDate: ref.isoDate });
    if (!f) {
      failures.push({ ref, reason: 'flight not found in local DB' });
      continue;
    }
    if (await refreshOneFlight(f, failures)) refreshed++;
  }
  return { refreshed, failures, total: refs.length };
}

// Soft-hide / restore a flight: it stops showing and being refreshed, but its
// observations are kept. Resolves by id or natural key. No JFE work.
export async function archiveFlight(payload) {
  const f = payload.flightId ? getFlight(payload.flightId) : findFlight(payload);
  if (f) setFlightActive(f.id, false);
  const flightNo = f ? f.flight_no : payload.flightNo;
  const isoDate = f ? f.iso_date : payload.isoDate;
  if (flightNo && isoDate) await mirrorFlightActive(flightNo, isoDate, false);
  logger.info({ flightNo, isoDate, inSqlite: Boolean(f) }, 'flight archived');
  return { flightNo, isoDate, archived: true };
}

export async function restoreFlight(payload) {
  const f = payload.flightId ? getFlight(payload.flightId) : findFlight(payload);
  if (f) setFlightActive(f.id, true);
  const flightNo = f ? f.flight_no : payload.flightNo;
  const isoDate = f ? f.iso_date : payload.isoDate;
  if (flightNo && isoDate) await mirrorFlightActive(flightNo, isoDate, true);
  logger.info({ flightNo, isoDate, inSqlite: Boolean(f) }, 'flight restored');
  return { flightNo, isoDate, restored: true };
}

export async function refreshAllActiveGroups() {
  const groups = listGroups().filter(g => g.active);
  const results = [];
  for (const g of groups) {
    results.push(await refreshGroup(g.id));
  }
  return results;
}

// Archive (soft-delete) a trip: hidden from the app and skipped by refreshAll,
// but the group row and ALL its flights/observations remain stored in both
// SQLite and Firestore. No JFE work involved. Reversible by setting active=1.
export async function archiveGroup(groupId) {
  const g = getGroup(groupId);
  if (g) setGroupActive(groupId, false);
  // Mirror regardless — the group may exist only in Firestore (e.g. archived
  // from the web before this machine ever synced it).
  await mirrorGroupActive(groupId, false);
  logger.info({ groupId, inSqlite: Boolean(g) }, 'group archived');
  return { groupId, archived: true };
}

export async function runRawCommand(command, { paginate = false } = {}) {
  if (paginate) {
    return enqueue(`raw paginated: ${command}`, () => runCommandPaginated(command));
  }
  return enqueue(`raw: ${command}`, () => runCommand(command));
}
