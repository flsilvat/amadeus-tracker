/**
 * Firestore mirror — best-effort secondary write target.
 *
 * SQLite is the source of truth; this just keeps a cloud copy so the React
 * app on GitHub Pages can read the data. All writes here are fire-and-forget
 * from the caller's perspective: errors are logged but never thrown, so a
 * Firestore outage can never break a SQLite write.
 *
 * Document IDs are deterministic so retries idempotently overwrite, and the
 * frontend can address things by predictable paths:
 *   groups/{groupId}
 *   flights/{flightNo}_{isoDate}
 *   observations/{flightNo}_{isoDate}_{queryTime}
 */
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';

let db = null;

export function initFirestore() {
  if (!config.FIRESTORE_ENABLED) {
    logger.info('Firestore disabled — running SQLite-only');
    return null;
  }

  try {
    if (!existsSync(config.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      logger.warn(
        { path: config.FIREBASE_SERVICE_ACCOUNT_PATH },
        'Firestore enabled but service-account file not found — disabling mirror'
      );
      return null;
    }

    const sa = JSON.parse(readFileSync(config.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'));

    if (!getApps().length) {
      initializeApp({ credential: cert(sa), projectId: sa.project_id });
    }
    db = getFirestore();

    // Ignore undefined fields silently — better-sqlite3 returns nulls for
    // empty columns, which we want to omit rather than send as undefined.
    db.settings({ ignoreUndefinedProperties: true });

    logger.info({ projectId: sa.project_id }, 'Firestore mirror ready');
    return db;
  } catch (err) {
    logger.error({ err: err.message }, 'Firestore init failed — disabling mirror');
    return null;
  }
}

const safeFireAndForget = (label, p) =>
  p.catch(err => logger.warn({ err: err.message, label }, 'mirror failed'));

export function mirrorGroup(group) {
  if (!db) return Promise.resolve();
  const doc = {
    id: group.id,
    name: group.name,
    outbound: group.outbound ?? null,
    inbound: group.inbound ?? null,
    myStfCode: group.myStfCode ?? null,
    myDoj: group.myDoj ?? null,
    active: group.active !== false,
    createdAt: group.createdAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
  return safeFireAndForget(
    `group ${group.id}`,
    db.collection('groups').doc(group.id).set(doc, { merge: true })
  );
}

export function mirrorFlight(flight) {
  if (!db) return Promise.resolve();
  const docId = `${flight.flight_no}_${flight.iso_date}`;
  const doc = {
    docId,
    groupId: flight.group_id,
    flightNo: flight.flight_no,
    isoDate: flight.iso_date,
    origin: flight.origin,
    destination: flight.destination,
    direction: flight.direction,
    depTime: flight.dep_time,
    arrTime: flight.arr_time,
    equipment: flight.equipment,
    discoveredAt: flight.discovered_at,
    updatedAt: FieldValue.serverTimestamp(),
  };
  return safeFireAndForget(
    `flight ${docId}`,
    db.collection('flights').doc(docId).set(doc, { merge: true })
  );
}

/**
 * Mirrors one observation with the cabin loads and queue embedded.
 *
 * Embedding the queue in the observation document (rather than a subcollection
 * of N rows) keeps Firestore write counts tiny — one doc per refresh per
 * flight — and keeps frontend reads to one round-trip.
 */
export function mirrorObservation({
  flightNo, isoDate, origin, destination, queryTime,
  daysToDeparture, cabins, queue, groupId, flightId,
}) {
  if (!db) return Promise.resolve();
  const docId = `${flightNo}_${isoDate}_${queryTime}`;
  const cabinsObj = {};
  for (const c of cabins) {
    cabinsObj[c.cabin] = {
      capacity: c.capacity,
      booked: c.booked,
      unsold: c.unsold,
      adjustments: c.adjustments,
      noComm: c.noComm,
    };
  }
  const doc = {
    docId,
    flightId,
    groupId,
    flightNo,
    isoDate,
    origin,
    destination,
    queryTime,
    daysToDeparture,
    cabins: cabinsObj,
    queue: queue.map(q => ({
      lineNo: q.lineNo,
      name: q.name,
      reservation: q.reservation,
      subcabin: q.subcabin,
      cabin: q.cabin,
      ptc: q.ptc,
      stfCode: q.stfCode,
      stfBucketNum: q.stfBucketNum,
      stfBucketLetter: q.stfBucketLetter,
      stfClassPref: q.stfClassPref,
      stfClassPrio: q.stfClassPrio,
      doj: q.doj,
      position: q.position,
    })),
    queueSize: queue.length,
    createdAt: FieldValue.serverTimestamp(),
  };
  return safeFireAndForget(
    `observation ${docId}`,
    db.collection('observations').doc(docId).set(doc)
  );
}

export function deleteGroupCascade(groupId) {
  if (!db) return Promise.resolve();
  return safeFireAndForget(
    `delete group ${groupId}`,
    (async () => {
      const batch = db.batch();
      batch.delete(db.collection('groups').doc(groupId));
      const flightSnap = await db.collection('flights').where('groupId', '==', groupId).get();
      flightSnap.forEach(d => batch.delete(d.ref));
      const obsSnap = await db.collection('observations').where('groupId', '==', groupId).get();
      obsSnap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    })()
  );
}

// ---------------------------------------------------------------------------
// Pending command queue (Phase 4)
//
// The web app can't reach this service directly (it's behind your work
// firewall and only runs when you're there), so it writes command documents to
// Firestore. This service, whenever it's running, picks them up, does the JFE
// work, and writes status back. Commands queued while the laptop is off wait.
// ---------------------------------------------------------------------------

// Listen for pending commands. cb receives an array (unordered; the processor
// sorts by createdAtMs). Single-field filter -> no composite index needed.
export function subscribePendingCommands(cb, onError) {
  if (!db) return () => {};
  return db.collection('commands').where('status', '==', 'pending').onSnapshot(
    (snap) =>
      cb(
        snap.docs.map((d) => {
          const data = d.data();
          return { id: d.id, ...data, createdAtMs: data.createdAt?.toMillis?.() ?? 0 };
        })
      ),
    (err) => {
      logger.warn({ err: err.message }, 'command subscribe failed');
      onError?.(err);
    }
  );
}

// Atomically claim a pending command (pending -> running). Returns the command
// if we won the claim, else null (already taken or gone).
export async function claimCommand(id) {
  if (!db) return null;
  const ref = db.collection('commands').doc(id);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data().status !== 'pending') return null;
      tx.update(ref, { status: 'running', startedAt: FieldValue.serverTimestamp() });
      return { id, ...snap.data() };
    });
  } catch (err) {
    logger.warn({ err: err.message, id }, 'claimCommand failed');
    return null;
  }
}

export async function completeCommand(id, result) {
  if (!db) return;
  await db
    .collection('commands')
    .doc(id)
    .update({
      status: 'done',
      finishedAt: FieldValue.serverTimestamp(),
      result: result ?? null,
      error: null,
    })
    .catch((err) => logger.warn({ err: err.message, id }, 'completeCommand failed'));
}

export async function failCommand(id, message) {
  if (!db) return;
  await db
    .collection('commands')
    .doc(id)
    .update({
      status: 'error',
      finishedAt: FieldValue.serverTimestamp(),
      error: String(message).slice(0, 500),
    })
    .catch((err) => logger.warn({ err: err.message, id }, 'failCommand failed'));
}

// On startup, any command still 'running' was orphaned by a crash / Ctrl-C
// (nothing else processes commands). Reset those to 'pending' so they resume,
// unless they've already been retried too many times (guards against a command
// that crashes the process on every attempt).
const MAX_COMMAND_ATTEMPTS = 3;

export async function reclaimStaleCommands() {
  if (!db) return 0;
  try {
    const snap = await db.collection('commands').where('status', '==', 'running').get();
    let reset = 0;
    for (const doc of snap.docs) {
      const attempts = (doc.data().attempts || 0) + 1;
      if (attempts > MAX_COMMAND_ATTEMPTS) {
        await doc.ref.update({
          status: 'error',
          error: 'Interrupted too many times — re-run manually',
          finishedAt: FieldValue.serverTimestamp(),
        });
      } else {
        await doc.ref.update({ status: 'pending', attempts, startedAt: null });
        reset += 1;
      }
    }
    if (snap.size) logger.info({ reset, total: snap.size }, 'reclaimed interrupted commands');
    return reset;
  } catch (err) {
    logger.warn({ err: err.message }, 'reclaimStaleCommands failed');
    return 0;
  }
}
