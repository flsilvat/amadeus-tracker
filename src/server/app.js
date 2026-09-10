import express from 'express';
import { z } from 'zod';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { jfeQueue } from '../queue.js';
import {
  createOrUpdateGroupAndDiscover,
  refreshGroup,
  refreshAllActiveGroups,
  refreshFlights,
  archiveGroup,
  archiveFlight,
  restoreFlight,
  runRawCommand,
} from '../service.js';
import {
  listGroups,
  getGroup,
  deleteGroup,
  listFlights,
  getFlight,
  listObservations,
  latestObservationsForGroup,
  latestObservationsForAllFlights,
  latestQueueForFlight,
  listFlightGroups,
  upsertFlightGroup,
  updateFlightGroup,
  deleteFlightGroup,
} from '../storage/sqlite.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  // CORS for the future React app (GitHub Pages). Tight but functional.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ----- health / status -----

  app.get('/health', (req, res) => {
    res.json({
      ok: true,
      dryRun: config.DRY_RUN,
      queue: { size: jfeQueue.size, pending: jfeQueue.pending },
      time: new Date().toISOString(),
    });
  });

  // ----- groups -----

  const legSchema = z.object({
    origin: z.string().length(3),
    destination: z.string().length(3),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });

  // STF code looks like "53B/J45" or "21A/J19" — bucket + class preference.
  // DOJ looks like "15JUN23" (DDMMM-YY). Both optional at the API level so
  // the React app can save a draft group before the user knows their ticket.
  const groupBodySchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    outbound: legSchema,
    inbound: legSchema.optional(),
    myStfCode: z.string().regex(/^\d+[A-Z]?\/[FJM]\d*$/i).optional().nullable(),
    myDoj: z.string().regex(/^\d{2}[A-Z]{3}\d{2}$/i).optional().nullable(),
  });

  app.get('/groups', (req, res) => {
    res.json(listGroups());
  });

  app.get('/groups/:id', (req, res) => {
    const g = getGroup(req.params.id);
    if (!g) return res.status(404).json({ error: 'not found' });
    res.json({
      ...g,
      flights: listFlights(g.id),
    });
  });

  // Create or update a group AND run AN to discover BA flights.
  // This is the "I just typed FROM/TO/DATE in the UI" endpoint.
  app.post('/groups', asyncH(async (req, res) => {
    const parsed = groupBodySchema.parse(req.body);
    const discovered = await createOrUpdateGroupAndDiscover(parsed);
    res.json({
      groupId: parsed.id,
      discovered: discovered.length,
      flights: discovered,
    });
  }));

  app.delete('/groups/:id', (req, res) => {
    deleteGroup(req.params.id);
    res.json({ deleted: req.params.id });
  });

  // ----- refresh (LL fan-out) -----

  // Trigger an LL refresh of all flights in a group.
  app.post('/groups/:id/refresh', asyncH(async (req, res) => {
    const result = await refreshGroup(req.params.id);
    res.json(result);
  }));

  // Trigger an LL refresh of every active group at once.
  app.post('/refresh-all', asyncH(async (req, res) => {
    const results = await refreshAllActiveGroups();
    res.json({ results });
  }));

  app.post('/refresh-flights', asyncH(async (req, res) => {
    const flights = z.array(z.object({
      flightNo: z.string().min(1),
      isoDate: z.string().min(1),
      origin: z.string().optional(),
    })).parse(req.body.flights || []);
    res.json(await refreshFlights(flights));
  }));

  app.post('/groups/:id/archive', asyncH(async (req, res) => {
    res.json(await archiveGroup(req.params.id));
  }));

  app.post('/flights/archive', asyncH(async (req, res) => {
    res.json(await archiveFlight(req.body));
  }));

  app.post('/flights/restore', asyncH(async (req, res) => {
    res.json(await restoreFlight(req.body));
  }));

  // ----- curated flight groups (cross-trip "custom groups") -----
  // Local-mode replacement for Firestore's flightGroups collection: the React
  // app reads and writes these here, so the list is shared by every browser
  // on this PC instead of living in one browser's localStorage.

  const flightRefSchema = z.object({
    flightNo: z.string().min(1),
    isoDate: z.string().min(1),
    origin: z.string().optional().nullable(),
    destination: z.string().optional().nullable(),
  }).passthrough();

  // Timestamps arrive as ISO strings, or as serialised Firestore Timestamps
  // ({ seconds, nanoseconds }) when importing an older browser-side copy.
  const isoOrUndefined = (v) => {
    if (typeof v === 'string' && v) return v;
    if (v && typeof v.seconds === 'number') return new Date(v.seconds * 1000).toISOString();
    return undefined;
  };

  const flightGroupSchema = z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    flights: z.array(flightRefSchema).default([]),
    // Free-form on purpose: the app saves the pass code as the user types it.
    myStfCode: z.string().optional().nullable(),
    myDoj: z.string().optional().nullable(),
    createdBy: z.string().optional().nullable(),
    createdAt: z.any().optional(),
    updatedAt: z.any().optional(),
  });

  const flightGroupPatchSchema = z.object({
    name: z.string().min(1).optional(),
    flights: z.array(flightRefSchema).optional(),
    myStfCode: z.string().optional().nullable(),
    myDoj: z.string().optional().nullable(),
  });

  const newFlightGroupId = () => `fg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const normaliseFlightGroup = (g) => ({
    ...g,
    id: g.id || newFlightGroupId(),
    createdAt: isoOrUndefined(g.createdAt),
    updatedAt: isoOrUndefined(g.updatedAt),
  });

  app.get('/flight-groups', (req, res) => {
    res.json(listFlightGroups());
  });

  app.post('/flight-groups', (req, res) => {
    const g = flightGroupSchema.parse(req.body);
    res.json(upsertFlightGroup(normaliseFlightGroup(g)));
  });

  // Bulk upsert that keeps ids. Used by the app to migrate groups an older
  // build saved in the browser's localStorage, and by
  // scripts/import-firestore-flight-groups.js.
  app.post('/flight-groups/import', (req, res) => {
    const groups = z.array(flightGroupSchema).parse(req.body.groups || []);
    const imported = groups.map((g) => upsertFlightGroup(normaliseFlightGroup(g)));
    res.json({ imported: imported.length, groups: imported });
  });

  app.put('/flight-groups/:id', (req, res) => {
    const patch = flightGroupPatchSchema.parse(req.body);
    const updated = updateFlightGroup(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: 'not found' });
    res.json(updated);
  });

  app.delete('/flight-groups/:id', (req, res) => {
    deleteFlightGroup(req.params.id);
    res.json({ deleted: req.params.id });
  });

  // ----- flights & observations (read API for the future React app) -----

  app.get('/groups/:id/latest', (req, res) => {
    res.json(latestObservationsForGroup(req.params.id).map((row) => ({
      ...row,
      queue: row.local_flight_id ? latestQueueForFlight(row.local_flight_id) : [],
    })));
  });

  // Latest observation (+ queue) for every stored flight across all trips —
  // what curated groups render from. Registered before /flights/:id so
  // "latest" isn't parsed as an id.
  app.get('/flights/latest', (req, res) => {
    res.json(latestObservationsForAllFlights());
  });

  app.get('/flights/:id', (req, res) => {
    const f = getFlight(parseInt(req.params.id, 10));
    if (!f) return res.status(404).json({ error: 'not found' });
    res.json(f);
  });

  app.get('/flights/:id/observations', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 5000);
    res.json(listObservations(parseInt(req.params.id, 10), limit));
  });

  // Latest staff-travel queue snapshot for a flight.
  app.get('/flights/:id/queue', (req, res) => {
    res.json(latestQueueForFlight(parseInt(req.params.id, 10)));
  });

  // Where would the group's STF code sit in the flight's current queue?
  // Returns { position, aheadOf, queueSize } or 404 if the group has no
  // STF code configured.
  app.get('/flights/:id/my-position', asyncH(async (req, res) => {
    const flightId = parseInt(req.params.id, 10);
    const flight = getFlight(flightId);
    if (!flight) return res.status(404).json({ error: 'flight not found' });

    const group = getGroup(flight.group_id);
    if (!group?.my_stf_code) {
      return res.status(404).json({ error: 'no STF code configured for this group' });
    }

    const queue = latestQueueForFlight(flightId);
    const { computePositionForStf } = await import('../amadeus/parser.js');
    const result = computePositionForStf(queue, group.my_stf_code, group.my_doj);
    res.json({ flightId, flightNo: flight.flight_no, ...result });
  }));

  // ----- ad-hoc raw command (escape hatch / debugging) -----

  const rawSchema = z.object({
    command: z.string().min(1).max(200),
    paginate: z.boolean().optional(),
  });
  app.post('/raw', asyncH(async (req, res) => {
    const { command, paginate } = rawSchema.parse(req.body);
    const result = await runRawCommand(command, { paginate });
    res.json(result);
  }));

  // ----- error handler -----

  app.use((err, req, res, next) => {
    logger.error({ err: err.message, path: req.path }, 'request failed');
    if (err.issues) {
      return res.status(400).json({ error: 'validation failed', issues: err.issues });
    }
    res.status(500).json({ error: err.message });
  });

  return app;
}

// Tiny helper so we can throw inside async route handlers.
function asyncH(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
