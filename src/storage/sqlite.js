/**
 * Storage layer — uses Node's built-in `node:sqlite` module (Node 22.5+).
 *
 * No native compilation needed. The API is very close to better-sqlite3,
 * with two small differences we handle here:
 *   - PRAGMA via db.exec() rather than db.pragma()
 *   - Manual BEGIN/COMMIT/ROLLBACK rather than db.transaction(fn)()
 *
 * Schema design notes
 * -------------------
 * - `groups`: a journey (outbound + optional inbound).
 * - `flights`: one row per discovered BA-operated flight in a group.
 * - `observations`: timeseries of LL snapshots — wide format, 4 cabins per row.
 * - `observation_cabins`: same data in long format (one row per cabin × snapshot).
 * - `queue_entries`: per-observation staff-travel queue snapshots. One row per
 *    passenger in the queue at the moment of the observation. This is the
 *    table that powers "where am I in the queue" and queue-history analysis.
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';

let db;

export function initDb() {
  mkdirSync(dirname(config.DB_PATH), { recursive: true });
  db = new DatabaseSync(config.DB_PATH);
  db.exec(`PRAGMA journal_mode = WAL`);
  db.exec(`PRAGMA foreign_keys = ON`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      outbound_origin TEXT,
      outbound_destination TEXT,
      outbound_date TEXT,
      inbound_origin TEXT,
      inbound_destination TEXT,
      inbound_date TEXT,
      my_stf_code TEXT,
      my_doj TEXT,
      created_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      flight_no TEXT NOT NULL,
      iso_date TEXT NOT NULL,
      origin TEXT NOT NULL,
      destination TEXT NOT NULL,
      direction TEXT NOT NULL,
      dep_time TEXT,
      arr_time TEXT,
      equipment TEXT,
      discovered_at TEXT NOT NULL,
      UNIQUE(group_id, flight_no, iso_date),
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_id INTEGER NOT NULL,
      query_time TEXT NOT NULL,
      days_to_departure REAL NOT NULL,
      f_capacity INTEGER, f_booked INTEGER, f_unsold INTEGER,
      j_capacity INTEGER, j_booked INTEGER, j_unsold INTEGER,
      w_capacity INTEGER, w_booked INTEGER, w_unsold INTEGER,
      m_capacity INTEGER, m_booked INTEGER, m_unsold INTEGER,
      raw_response TEXT,
      FOREIGN KEY (flight_id) REFERENCES flights(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_obs_flight_time ON observations(flight_id, query_time);
    CREATE INDEX IF NOT EXISTS idx_obs_days ON observations(days_to_departure);

    CREATE TABLE IF NOT EXISTS observation_cabins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_id INTEGER NOT NULL,
      flight_id INTEGER NOT NULL,
      query_time TEXT NOT NULL,
      days_to_departure REAL NOT NULL,
      cabin TEXT NOT NULL,
      capacity INTEGER, adjustments INTEGER, unsold INTEGER, booked INTEGER, no_comm INTEGER,
      FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
      FOREIGN KEY (flight_id) REFERENCES flights(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_obs_cab_flight ON observation_cabins(flight_id, query_time);

    -- Staff-travel queue snapshot. One row per passenger present in the queue
    -- at the moment of an observation. Position is 1-based and assigned by the
    -- service layer using BA's priority rules (STF bucket → letter → DOJ).
    CREATE TABLE IF NOT EXISTS queue_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      observation_id INTEGER NOT NULL,
      flight_id INTEGER NOT NULL,
      query_time TEXT NOT NULL,
      line_no TEXT,           -- the "001"/"002"/... displayed in JFE
      passenger_name TEXT,
      reservation TEXT,
      subcabin TEXT,          -- raw letter (Y/B/H/M/...)
      cabin TEXT,             -- mapped main cabin (F/J/W/M)
      ptc TEXT,               -- SBY / BKB / ADT
      stf_code TEXT,          -- e.g. "53B/J45"
      stf_bucket_num INTEGER, -- 53
      stf_bucket_letter TEXT, -- "B"
      stf_class_pref TEXT,    -- F / J / M / null
      stf_class_prio INTEGER, -- 45 (lower = higher priority)
      doj TEXT,               -- date of joining, "15JUN23" raw
      position INTEGER,       -- 1-based queue position after sort
      FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
      FOREIGN KEY (flight_id) REFERENCES flights(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_q_flight_time ON queue_entries(flight_id, query_time);
    CREATE INDEX IF NOT EXISTS idx_q_obs ON queue_entries(observation_id);
  `);

  logger.info({ path: config.DB_PATH }, 'database ready');

  // --- Lightweight migrations for users with pre-existing databases ---
  // CREATE TABLE IF NOT EXISTS won't add new columns to an existing table,
  // so we ALTER it explicitly if the columns are missing.
  const groupCols = db.prepare(`SELECT name FROM pragma_table_info('groups')`).all().map(r => r.name);
  if (!groupCols.includes('my_stf_code')) {
    db.exec(`ALTER TABLE groups ADD COLUMN my_stf_code TEXT`);
    logger.info('migration: added groups.my_stf_code');
  }
  if (!groupCols.includes('my_doj')) {
    db.exec(`ALTER TABLE groups ADD COLUMN my_doj TEXT`);
    logger.info('migration: added groups.my_doj');
  }

  return db;
}

export function getDb() {
  if (!db) initDb();
  return db;
}

// ---------- groups ----------

export function upsertGroup(g) {
  const stmt = getDb().prepare(`
    INSERT INTO groups (id, name, outbound_origin, outbound_destination, outbound_date,
                        inbound_origin, inbound_destination, inbound_date,
                        my_stf_code, my_doj, created_at, active)
    VALUES (@id, @name, @outbound_origin, @outbound_destination, @outbound_date,
            @inbound_origin, @inbound_destination, @inbound_date,
            @my_stf_code, @my_doj, @created_at, @active)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      outbound_origin = excluded.outbound_origin,
      outbound_destination = excluded.outbound_destination,
      outbound_date = excluded.outbound_date,
      inbound_origin = excluded.inbound_origin,
      inbound_destination = excluded.inbound_destination,
      inbound_date = excluded.inbound_date,
      my_stf_code = excluded.my_stf_code,
      my_doj = excluded.my_doj,
      active = excluded.active
  `);
  stmt.run({
    id: g.id,
    name: g.name,
    outbound_origin: g.outbound?.origin ?? null,
    outbound_destination: g.outbound?.destination ?? null,
    outbound_date: g.outbound?.date ?? null,
    inbound_origin: g.inbound?.origin ?? null,
    inbound_destination: g.inbound?.destination ?? null,
    inbound_date: g.inbound?.date ?? null,
    my_stf_code: g.myStfCode ?? null,
    my_doj: g.myDoj ?? null,
    created_at: g.createdAt ?? new Date().toISOString(),
    active: g.active === false ? 0 : 1,
  });
}

export function listGroups() {
  return getDb().prepare(`SELECT * FROM groups ORDER BY created_at DESC`).all();
}

export function getGroup(id) {
  return getDb().prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
}

export function deleteGroup(id) {
  return getDb().prepare(`DELETE FROM groups WHERE id = ?`).run(id);
}

// ---------- flights ----------

export function upsertFlight(f) {
  const stmt = getDb().prepare(`
    INSERT INTO flights (group_id, flight_no, iso_date, origin, destination,
                         direction, dep_time, arr_time, equipment, discovered_at)
    VALUES (@group_id, @flight_no, @iso_date, @origin, @destination,
            @direction, @dep_time, @arr_time, @equipment, @discovered_at)
    ON CONFLICT(group_id, flight_no, iso_date) DO UPDATE SET
      dep_time = excluded.dep_time,
      arr_time = excluded.arr_time,
      equipment = excluded.equipment
    RETURNING id
  `);
  return stmt.get({
    group_id: f.groupId,
    flight_no: f.flightNo,
    iso_date: f.isoDate,
    origin: f.origin,
    destination: f.destination,
    direction: f.direction,
    dep_time: f.depTime ?? null,
    arr_time: f.arrTime ?? null,
    equipment: f.equipment ?? null,
    discovered_at: f.discoveredAt ?? new Date().toISOString(),
  }).id;
}

export function listFlights(groupId) {
  if (groupId) {
    return getDb().prepare(`SELECT * FROM flights WHERE group_id = ? ORDER BY iso_date, dep_time`).all(groupId);
  }
  return getDb().prepare(`SELECT * FROM flights ORDER BY iso_date, dep_time`).all();
}

export function getFlight(id) {
  return getDb().prepare(`SELECT * FROM flights WHERE id = ?`).get(id);
}

// ---------- observations + queue (transactional) ----------

/**
 * Inserts one snapshot (cabins + queue) atomically.
 *
 * @param {{
 *   flightId: number,
 *   isoDate: string,
 *   queryTime: string,
 *   cabins: Array,
 *   queueEntries: Array,     // optional, defaults to []
 *   rawResponse: string,
 * }} input
 * @returns {number} the new observation id
 */
export function insertObservation({ flightId, isoDate, queryTime, cabins, queueEntries = [], rawResponse }) {
  const daysToDep =
    (new Date(isoDate + 'T00:00:00Z').getTime() - new Date(queryTime).getTime()) /
    (1000 * 60 * 60 * 24);

  const by = {};
  for (const c of cabins) by[c.cabin] = c;
  const get = (cab, field) => by[cab]?.[field] ?? null;

  const insertObs = getDb().prepare(`
    INSERT INTO observations
      (flight_id, query_time, days_to_departure,
       f_capacity, f_booked, f_unsold,
       j_capacity, j_booked, j_unsold,
       w_capacity, w_booked, w_unsold,
       m_capacity, m_booked, m_unsold,
       raw_response)
    VALUES
      (@flight_id, @query_time, @days_to_departure,
       @f_capacity, @f_booked, @f_unsold,
       @j_capacity, @j_booked, @j_unsold,
       @w_capacity, @w_booked, @w_unsold,
       @m_capacity, @m_booked, @m_unsold,
       @raw_response)
    RETURNING id
  `);

  const insertCab = getDb().prepare(`
    INSERT INTO observation_cabins
      (observation_id, flight_id, query_time, days_to_departure,
       cabin, capacity, adjustments, unsold, booked, no_comm)
    VALUES (@observation_id, @flight_id, @query_time, @days_to_departure,
            @cabin, @capacity, @adjustments, @unsold, @booked, @no_comm)
  `);

  const insertQ = getDb().prepare(`
    INSERT INTO queue_entries
      (observation_id, flight_id, query_time, line_no, passenger_name, reservation,
       subcabin, cabin, ptc, stf_code, stf_bucket_num, stf_bucket_letter,
       stf_class_pref, stf_class_prio, doj, position)
    VALUES
      (@observation_id, @flight_id, @query_time, @line_no, @passenger_name, @reservation,
       @subcabin, @cabin, @ptc, @stf_code, @stf_bucket_num, @stf_bucket_letter,
       @stf_class_pref, @stf_class_prio, @doj, @position)
  `);

  const database = getDb();
  database.exec('BEGIN');
  try {
    const obsId = insertObs.get({
      flight_id: flightId,
      query_time: queryTime,
      days_to_departure: daysToDep,
      f_capacity: get('F', 'capacity'), f_booked: get('F', 'booked'), f_unsold: get('F', 'unsold'),
      j_capacity: get('J', 'capacity'), j_booked: get('J', 'booked'), j_unsold: get('J', 'unsold'),
      w_capacity: get('W', 'capacity'), w_booked: get('W', 'booked'), w_unsold: get('W', 'unsold'),
      m_capacity: get('M', 'capacity'), m_booked: get('M', 'booked'), m_unsold: get('M', 'unsold'),
      raw_response: rawResponse ?? null,
    }).id;

    for (const c of cabins) {
      insertCab.run({
        observation_id: obsId,
        flight_id: flightId,
        query_time: queryTime,
        days_to_departure: daysToDep,
        cabin: c.cabin,
        capacity: c.capacity,
        adjustments: c.adjustments,
        unsold: c.unsold,
        booked: c.booked,
        no_comm: c.noComm,
      });
    }

    for (const q of queueEntries) {
      insertQ.run({
        observation_id: obsId,
        flight_id: flightId,
        query_time: queryTime,
        line_no: q.lineNo ?? null,
        passenger_name: q.name ?? null,
        reservation: q.reservation ?? null,
        subcabin: q.subcabin ?? null,
        cabin: q.cabin ?? null,
        ptc: q.ptc ?? null,
        stf_code: q.stfCode ?? null,
        stf_bucket_num: q.stfBucketNum ?? null,
        stf_bucket_letter: q.stfBucketLetter ?? null,
        stf_class_pref: q.stfClassPref ?? null,
        stf_class_prio: q.stfClassPrio ?? null,
        doj: q.doj ?? null,
        position: q.position ?? null,
      });
    }

    database.exec('COMMIT');
    return obsId;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}

export function listObservations(flightId, limit = 200) {
  return getDb()
    .prepare(`SELECT * FROM observations WHERE flight_id = ? ORDER BY query_time DESC LIMIT ?`)
    .all(flightId, limit);
}

/**
 * Latest observation per flight in a group, joined with flight row.
 * What the UI cards consume.
 */
export function latestObservationsForGroup(groupId) {
  return getDb().prepare(`
    SELECT f.*, o.*
    FROM flights f
    LEFT JOIN observations o ON o.id = (
      SELECT id FROM observations
      WHERE flight_id = f.id
      ORDER BY query_time DESC
      LIMIT 1
    )
    WHERE f.group_id = ?
    ORDER BY f.direction, f.iso_date, f.dep_time
  `).all(groupId);
}

/**
 * Queue snapshot for one observation, ordered by position.
 */
export function queueForObservation(observationId) {
  return getDb().prepare(`
    SELECT * FROM queue_entries WHERE observation_id = ? ORDER BY position ASC
  `).all(observationId);
}

/**
 * Latest queue snapshot for a flight.
 */
export function latestQueueForFlight(flightId) {
  return getDb().prepare(`
    SELECT q.*
    FROM queue_entries q
    WHERE q.observation_id = (
      SELECT id FROM observations WHERE flight_id = ? ORDER BY query_time DESC LIMIT 1
    )
    ORDER BY q.position ASC
  `).all(flightId);
}
