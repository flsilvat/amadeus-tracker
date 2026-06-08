// Phase 4 — write command docs the local service picks up, and watch their status.
import { addDoc, collection, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { db, auth } from '../firebase.js';

function genGroupId(outbound) {
  const base = `${outbound.origin}-${outbound.destination}-${outbound.date.replace(/-/g, '')}`.toLowerCase();
  const rand = Math.random().toString(36).slice(2, 6);
  return `trip-${base}-${rand}`;
}

async function enqueue(type, payload, label) {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  return addDoc(collection(db, 'commands'), {
    type,
    payload,
    label: label || type,
    status: 'pending',
    createdBy: uid,
    createdAt: serverTimestamp(),
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  });
}

export function enqueueCreateGroup({ name, outbound, inbound, myStfCode, myDoj }) {
  const group = { id: genGroupId(outbound), name, outbound };
  if (inbound) group.inbound = inbound;
  if (myStfCode) group.myStfCode = myStfCode;
  if (myDoj) group.myDoj = myDoj;
  return enqueue('createGroup', { group }, `Add ${outbound.origin}\u2192${outbound.destination} ${outbound.date}`);
}

export function enqueueRefreshGroup(groupId, label) {
  return enqueue('refreshGroup', { groupId }, label || 'Refresh loads');
}

export function enqueueRefreshAll() {
  return enqueue('refreshAll', {}, 'Refresh all trips');
}

// Sync an archive to the work PC's local DB (the web already flipped the
// Firestore doc; this stops the service refreshing the trip).
export function enqueueArchiveGroup(groupId, name) {
  return enqueue('archiveGroup', { groupId }, `Archive ${name || groupId}`);
}

// Re-run AN discovery for an EXISTING trip to pick up flights missed the first
// time (e.g. dropped by an NMD earlier). Uses the same trip id, so it upserts —
// it never duplicates or deletes flights, and leaves loads/queues alone.
export function enqueueRescan(group) {
  const g = { id: group.id, name: group.name, outbound: group.outbound };
  if (group.inbound) g.inbound = group.inbound;
  if (group.myStfCode) g.myStfCode = group.myStfCode;
  if (group.myDoj) g.myDoj = group.myDoj;
  return enqueue('createGroup', { group: g }, `Re-scan ${group.name}`);
}

// Re-queue a failed or stuck command as a fresh pending one. Re-running is safe:
// createGroup/refresh upsert by the same id, so no duplicates are created.
export function reEnqueueCommand(cmd) {
  return enqueue(cmd.type, cmd.payload || {}, cmd.label || cmd.type);
}

// Recent commands for this user, newest first (client-sorted -> no index).
export function subscribeRecentCommands(cb, onError) {
  const uid = auth.currentUser ? auth.currentUser.uid : null;
  const q = uid
    ? query(collection(db, 'commands'), where('createdBy', '==', uid))
    : query(collection(db, 'commands'));
  return onSnapshot(
    q,
    (snap) => {
      const cmds = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      cmds.sort((a, b) => (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0) -
        (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0));
      cb(cmds.slice(0, 8));
    },
    onError
  );
}
