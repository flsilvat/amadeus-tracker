import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './context/AuthContext.jsx';
import { useAppState } from './hooks/useAppState.js';
import {
  subscribeGroups, subscribeGroupFlights, MOCK_GROUP, MOCK_FLIGHTS, isDemo,
} from './lib/data.js';
import { computeOdds } from './lib/odds.js';
import Login from './components/Login.jsx';
import Section from './components/Section.jsx';

const segBtn = (active) =>
  'px-3 py-1.5 text-xs font-semibold transition ' +
  (active ? 'btn-ink' : 'bg-white text-stone-600 hover:bg-stone-50');

const ODDS_RANK = { blue: 0, amber: 1, neutral: 2, red: 3 };

export default function App() {
  const { user, loading, demo, signOutUser } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-stone-400 text-sm">Loading…</div>;
  }
  if (!demo && !user) return <Login />;

  return <Dashboard uid={user ? user.uid : null} demo={demo} onSignOut={signOutUser} />;
}

function Dashboard({ uid, demo, onSignOut }) {
  const app = useAppState(uid, demo);

  // ---- groups + flights (live, or mock in demo) --------------------------
  const [groups, setGroups] = useState(demo ? [MOCK_GROUP] : []);
  const [groupId, setGroupId] = useState(demo ? MOCK_GROUP.id : null);
  const [flights, setFlights] = useState(demo ? MOCK_FLIGHTS : []);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (demo) return;
    return subscribeGroups(
      (gs) => {
        setGroups(gs);
        setGroupId((cur) => (cur && gs.some((g) => g.id === cur) ? cur : (gs[0] ? gs[0].id : null)));
      },
      (e) => setErr(e.message)
    );
  }, [demo]);

  useEffect(() => {
    if (demo || !groupId) return;
    setFlights([]);
    return subscribeGroupFlights(groupId, setFlights, (e) => setErr(e.message));
  }, [demo, groupId]);

  const group = groups.find((g) => g.id === groupId) || null;

  // ---- pass code: per-user override, else the group default --------------
  const override = group ? app.passcodeFor(group.id) : null;
  const myCode = override ? override.stfCode : (group ? group.myStfCode || '' : '');
  const myDoj = override ? override.doj : (group ? group.myDoj || '' : '');

  // ---- view controls -----------------------------------------------------
  const [sortMode, setSortMode] = useState('time');
  const [cols, setCols] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 2 : 3));
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 500);
  const [openFlights, setOpenFlights] = useState(() => new Set());

  useEffect(() => {
    const onResize = () => setIsPhone(window.innerWidth <= 500);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleOpen = (k) =>
    setOpenFlights((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allKeys = flights.map((f) => `${f.flightNo}_${f.isoDate}`);
  const allOpen = allKeys.length > 0 && openFlights.size === allKeys.length;
  const expandAll = () => setOpenFlights(new Set(allKeys));
  const collapseAll = () => setOpenFlights(new Set());

  const sortFlights = (list) => {
    const arr = [...list];
    if (sortMode === 'odds') {
      arr.sort((a, b) => {
        const ca = computeOdds(a, myCode, myDoj, app.confirmedSetFor(`${a.flightNo}_${a.isoDate}`)).color;
        const cb = computeOdds(b, myCode, myDoj, app.confirmedSetFor(`${b.flightNo}_${b.isoDate}`)).color;
        if (ODDS_RANK[ca] !== ODDS_RANK[cb]) return ODDS_RANK[ca] - ODDS_RANK[cb];
        return (a.depTime || '').localeCompare(b.depTime || '');
      });
    } else {
      arr.sort((a, b) => (a.depTime || '').localeCompare(b.depTime || ''));
    }
    return arr;
  };

  const outbound = useMemo(() => sortFlights(flights.filter((f) => f.direction === 'outbound')), [flights, sortMode, myCode, myDoj, app.state]);
  const inbound = useMemo(() => sortFlights(flights.filter((f) => f.direction === 'inbound')), [flights, sortMode, myCode, myDoj, app.state]);

  const shared = { ...app, openFlights, toggleOpen };

  return (
    <div className="max-w-[1272px] mx-auto px-3 py-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight truncate">{group ? group.name : 'Staff travel odds'}</h1>
          <p className="text-xs text-stone-500">
            staff travel odds{demo && <span className="ml-1 text-amber-600 font-semibold">· demo</span>}
          </p>
        </div>
        {!demo && (
          <button onClick={onSignOut} className="text-xs text-stone-400 hover:text-stone-600 shrink-0 mt-1">Sign out</button>
        )}
      </header>

      {err && <p className="text-xs text-rose-600 mb-3">{err}</p>}

      {groups.length === 0 && !demo ? (
        <div className="bg-white rounded-2xl border border-stone-200 p-6 text-sm text-stone-500">
          No active trips found yet. Create one from your tracker service, or append <code>?demo=1</code> to the URL to preview with sample data.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-stone-200 p-3 mb-4 flex flex-wrap items-end gap-3">
            {groups.length > 1 && (
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Trip</span>
                <select value={groupId || ''} onChange={(e) => setGroupId(e.target.value)}
                  className="text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:border-blue-400">
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Pass code</span>
              <input value={myCode} onChange={(e) => group && app.setPasscode(group.id, e.target.value, myDoj)}
                placeholder="21/J19"
                className="font-mono text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 w-24 focus:outline-none focus:border-blue-400" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">DOJ</span>
              <input value={myDoj} onChange={(e) => group && app.setPasscode(group.id, myCode, e.target.value)}
                placeholder="15JUN18"
                className="font-mono text-sm border border-stone-300 rounded-lg px-2.5 py-1.5 w-24 focus:outline-none focus:border-blue-400" />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Sort</span>
              <div className="inline-flex rounded-lg border border-stone-300 overflow-hidden">
                <button onClick={() => setSortMode('time')} className={segBtn(sortMode === 'time')}>Earliest</button>
                <button onClick={() => setSortMode('odds')} className={segBtn(sortMode === 'odds') + ' border-l border-stone-300'}>Odds</button>
              </div>
            </div>

            {!isPhone && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wide">Columns</span>
                <div className="inline-flex rounded-lg border border-stone-300 overflow-hidden">
                  {[2, 3, 4].map((n) => (
                    <button key={n} onClick={() => setCols(n)} className={segBtn(cols === n) + (n !== 2 ? ' border-l border-stone-300' : '')}>{n}</button>
                  ))}
                </div>
              </div>
            )}

            <button onClick={allOpen ? collapseAll : expandAll}
              className="ml-auto self-end text-xs font-semibold border border-stone-300 rounded-lg px-3 py-1.5 bg-white text-stone-600 hover:bg-stone-50 transition">
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mb-4 text-[11px]">
            {[['odds-blue', 'Club'], ['odds-amber', 'On'], ['odds-red', 'Unlikely'], ['odds-neutral', 'No data']].map(([cls, label]) => (
              <div key={cls} className="flex items-center gap-1.5">
                <span className={'inline-block w-3.5 h-3.5 rounded border-2 ' + cls} />
                <span className="text-stone-500">{label}</span>
              </div>
            ))}
          </div>

          <Section title={`Outbound${outbound[0] ? ' · ' + outbound[0].origin + ' → ' + outbound[0].destination : ''}`}
            flights={outbound} cols={cols} isPhone={isPhone} app={shared} myCode={myCode} myDoj={myDoj} />
          <Section title={`Inbound${inbound[0] ? ' · ' + inbound[0].origin + ' → ' + inbound[0].destination : ''}`}
            flights={inbound} cols={cols} isPhone={isPhone} app={shared} myCode={myCode} myDoj={myDoj} />

          {flights.length === 0 && groupId && (
            <p className="text-sm text-stone-400">No flights for this trip yet.</p>
          )}
        </>
      )}
    </div>
  );
}
