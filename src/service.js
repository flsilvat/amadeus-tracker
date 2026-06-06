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
} from './storage/sqlite.js';
import { mirrorGroup, mirrorFlight, mirrorObservation } from './storage/firestore.js';

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
export async function refreshGroup(groupId) {
  const group = getGroup(groupId);
  if (!group) throw new Error(`Unknown group: ${groupId}`);

  const flights = listFlights(groupId);
  if (!flights.length) {
    logger.warn({ groupId }, 'refreshGroup: no flights to refresh');
    return { groupId, refreshed: 0 };
  }

  let refreshed = 0;
  const failures = [];

  for (const f of flights) {
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
        continue;
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

      // Mirror to Firestore — include groupId so the frontend can filter.
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
      refreshed++;
    } catch (err) {
      logger.error({ flight: f.flight_no, err: err.message }, 'LL failed');
      failures.push({ flightId: f.id, reason: err.message });
    }
  }

  return { groupId, refreshed, failures, total: flights.length };
}

export async function refreshAllActiveGroups() {
  const groups = listGroups().filter(g => g.active);
  const results = [];
  for (const g of groups) {
    results.push(await refreshGroup(g.id));
  }
  return results;
}

export async function runRawCommand(command, { paginate = false } = {}) {
  if (paginate) {
    return enqueue(`raw paginated: ${command}`, () => runCommandPaginated(command));
  }
  return enqueue(`raw: ${command}`, () => runCommand(command));
}
