import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase.js';

// Shape persisted at /appState/{uid}:
// {
//   favorites:      { "BA0047_2026-07-15": true },
//   confirmations:  { "BA0049_2026-07-15": { "FROST/KE|YZ33CC|18/J11": true } },
//   passcodes:      { "trip-sea-jul-26": { stfCode: "21/J19", doj: "15JUN18" } }
// }
const EMPTY = { favorites: {}, confirmations: {}, passcodes: {} };

export function useAppState(uid, demo) {
  const [state, setState] = useState(EMPTY);
  const ready = useRef(false);

  // Load + live-sync (skip Firestore entirely in demo mode).
  useEffect(() => {
    if (demo || !uid) { ready.current = true; return; }
    const ref = doc(db, 'appState', uid);
    return onSnapshot(ref, (snap) => {
      setState({ ...EMPTY, ...(snap.exists() ? snap.data() : {}) });
      ready.current = true;
    });
  }, [uid, demo]);

  // Persist on change (debounced, merge write). No-op in demo mode.
  const persist = useCallback((next) => {
    setState(next);
    if (demo || !uid) return;
    setDoc(doc(db, 'appState', uid), next, { merge: true }).catch((e) =>
      console.warn('appState write failed', e)
    );
  }, [uid, demo]);

  const toggleFavorite = useCallback((flightKey) => {
    setState((prev) => {
      const favorites = { ...prev.favorites };
      if (favorites[flightKey]) delete favorites[flightKey];
      else favorites[flightKey] = true;
      const next = { ...prev, favorites };
      if (!demo && uid) setDoc(doc(db, 'appState', uid), { favorites }, { merge: true }).catch(() => {});
      return next;
    });
  }, [uid, demo]);

  const toggleConfirm = useCallback((flightKey, paxKey) => {
    setState((prev) => {
      const confirmations = { ...prev.confirmations };
      const forFlight = { ...(confirmations[flightKey] || {}) };
      if (forFlight[paxKey]) delete forFlight[paxKey];
      else forFlight[paxKey] = true;
      confirmations[flightKey] = forFlight;
      const next = { ...prev, confirmations };
      if (!demo && uid) setDoc(doc(db, 'appState', uid), { confirmations }, { merge: true }).catch(() => {});
      return next;
    });
  }, [uid, demo]);

  const setPasscode = useCallback((groupId, stfCode, doj) => {
    setState((prev) => {
      const passcodes = { ...prev.passcodes, [groupId]: { stfCode, doj } };
      const next = { ...prev, passcodes };
      if (!demo && uid) setDoc(doc(db, 'appState', uid), { passcodes }, { merge: true }).catch(() => {});
      return next;
    });
  }, [uid, demo]);

  // Helpers
  const isFavorite = (flightKey) => !!state.favorites[flightKey];
  const confirmedSetFor = (flightKey) => new Set(Object.keys(state.confirmations[flightKey] || {}));
  const passcodeFor = (groupId) => state.passcodes[groupId] || null;

  return { state, isFavorite, toggleFavorite, confirmedSetFor, toggleConfirm, passcodeFor, setPasscode, persist };
}
