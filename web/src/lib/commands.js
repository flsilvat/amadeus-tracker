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
