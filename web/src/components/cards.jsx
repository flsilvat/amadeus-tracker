import { useMemo, useState } from 'react';
import { computeOdds, paxKey, ODDS_META } from '../lib/odds.js';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CABIN_SHORT = { F: 'First', J: 'Club', W: 'Eco+', M: 'Eco' };

// Small stroke camera glyph for the "copy as image" buttons (Feather "camera").
export function CameraIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

// Unified loads grid. Collapsed: a single "free" row of net seats per cabin
// (F/J/W/M) with small mono tags. Expanded: drops "cap" and "bkd" rows beneath,
// aligned in the same four cabin columns. Tight column gap; JetBrains Mono.
export function CabinStrip({ cabins, expanded = false, queue = null }) {
  const order = ['F', 'J', 'W', 'M'].filter((c) => cabins[c]);
  const tag = (c) => 'text-[10px] ' + (c === 'J' ? 'text-blue-500' : 'text-stone-400');
  const net = (c) => cabins[c].capacity - cabins[c].booked;
  const netCls = (c) => 'font-bold ' + (net(c) < 0 ? 'text-rose-600' : c === 'J' ? 'text-blue-700' : 'text-stone-700');
  return (
    <div className="font-mono tnum grid gap-y-0.5 items-baseline"
      style={{ gridTemplateColumns: `auto repeat(${order.length}, auto)${queue !== null ? ' auto' : ''}`, columnGap: '14px', justifyContent: 'start' }}>
      <span className="text-[10px] text-stone-400">free</span>
      {order.map((c) => (
        <span key={'n' + c} className="text-[13px] flex items-baseline gap-0.5">
          <span className={tag(c)}>{c}</span><span className={netCls(c)}>{net(c)}</span>
        </span>
      ))}
      {queue !== null && (
        <span className="text-[13px] flex items-baseline gap-1 whitespace-nowrap" style={{ marginLeft: '-6px' }}>
          <span className="text-stone-300">//</span>
          <span className="text-[10px] text-stone-400">q</span><span className="font-bold text-stone-700">{queue}</span>
        </span>
      )}
      {expanded && (
        <>
          <span className="text-[10px] text-stone-400">cap</span>
          {order.map((c) => (
            <span key={'c' + c} className="text-[12px] text-stone-500">{cabins[c].capacity}</span>
          ))}
          {queue !== null && <span />}
          <span className="text-[10px] text-stone-400">bkd</span>
          {order.map((c) => (
            <span key={'b' + c} className="text-[12px] text-stone-500">{cabins[c].booked}</span>
          ))}
          {queue !== null && <span />}
        </>
      )}
    </div>
  );
}

// tiny helper so the grid cells are direct children (keeps columns aligned)
function Fragmentish({ children }) {
  return <>{children}</>;
}


// "Last updated" stamp: always day + month + time (e.g. "9 Oct 14:32"), even
// when the loads were captured today. The cards get screenshotted and shared,
// so the date has to be on the image.
function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// readOnly: no confirm checkboxes (used by the image export). Confirmed pax
// still render struck through so the picture matches what the UI shows.
export function QueueTable({ result, myCode, confirmedSet, onToggleConfirm, readOnly = false }) {
  const { queue, dividerIndex, meKeys = new Set() } = result;
  const matched = meKeys.size > 0;
  const Divider = () => (
    <tr>
      <td colSpan={readOnly ? 5 : 6} className="py-1">
        <div className="flex items-center gap-2 text-blue-600 font-sans font-semibold text-[10px]">
          <div className="flex-1 border-t-2 border-dashed border-blue-300" />
          {matched ? 'YOU ↑' : 'YOU'} · {myCode}
          <div className="flex-1 border-t-2 border-dashed border-blue-300" />
        </div>
      </td>
    </tr>
  );
  return (
    <div className="mt-1 border-t border-stone-100 pt-2">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="text-stone-400 text-left">
            {!readOnly && <th className="w-6"></th>}<th>Name</th><th>Cab</th><th>PNR</th><th>Code</th><th>DOJ</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((p, idx) => {
            const k = paxKey(p);
            const confirmed = confirmedSet.has(k);
            const isMe = !confirmed && meKeys.has(k);
            return (
              <Fragmentish key={k + idx}>
                {idx === dividerIndex && myCode && <Divider />}
                <tr className={confirmed ? 'text-stone-300 line-through' : isMe ? 'text-blue-700 bg-blue-50/70' : 'text-stone-700'}>
                  {!readOnly && (
                    <td className="text-center">
                      <input type="checkbox" checked={confirmed} onChange={() => onToggleConfirm(k)}
                        title="Mark confirmed (remove from queue + odds)" />
                    </td>
                  )}
                  <td className="pr-1 whitespace-nowrap" title={p.name}>{(p.name || '').slice(0, 14)}</td>
                  <td className="text-center">{p.subcabin}</td>
                  <td className="whitespace-nowrap">{p.reservation}</td>
                  <td className="font-bold whitespace-nowrap">{p.stfCode}</td>
                  <td className={'whitespace-nowrap ' + (isMe ? 'text-blue-400' : 'text-stone-400')}>{p.doj}</td>
                </tr>
              </Fragmentish>
            );
          })}
          {myCode && dividerIndex === queue.length && <Divider />}
        </tbody>
      </table>
    </div>
  );
}

// snapshot: static rendering for the image export — the same card without
// buttons or checkboxes. `open` still decides whether the passenger queue
// shows, so the picture carries exactly the detail that is on screen.
export function FlightCard({ flight, myCode, myDoj, confirmedSet, onToggleConfirm, starred, onToggleStar, open, onToggleOpen, actions, snapshot = false }) {
  const result = useMemo(() => computeOdds(flight, myCode, myDoj, confirmedSet), [flight, myCode, myDoj, confirmedSet]);
  const meta = ODDS_META[result.color];
  const fnNum = flight.flightNo.slice(0, 2) + (+flight.flightNo.slice(2)); // BA49
  const dateShort = WEEKDAYS[new Date(flight.isoDate + 'T00:00:00').getDay()] + ' ' +
    (+flight.isoDate.slice(8)) + ' ' + MONTHS[+flight.isoDate.slice(5, 7)];
  const hidden = flight.active === false;
  const durStr = flight.durationMin
    ? Math.floor(flight.durationMin / 60) + 'h' + String(flight.durationMin % 60).padStart(2, '0')
    : null;
  const hasCabins = Object.keys(flight.cabins).length > 0;

  // Short odds word for the pill: "Club" / "First" / "Eco+" / "Eco" / "Unlikely".
  const pillLabel = result.color === 'blue'
    ? (result.myCabin === 'F' ? 'First' : 'Club')
    : result.color === 'amber'
      ? (CABIN_SHORT[result.myCabin] || 'Eco')
      : result.color === 'red' ? 'Unlikely' : 'Set code';

  const detailsToggle = (extra = '') => !snapshot && (
    <button onClick={onToggleOpen}
      className={'shrink-0 font-mono text-[11px] text-stone-400 hover:text-stone-700 transition flex items-center gap-1 ' + extra}>
      details <span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
  );
  // Lives on the loads footer line (the roomiest row), not in the header:
  // every icon up there steals width from the route/pill row on a 300px card.
  const snapshotBtn = !snapshot && actions?.onSnapshot && (
    <button onClick={() => actions.onSnapshot(flight)} aria-label={`Copy ${fnNum} as an image`} title="Copy this card as an image"
      className="shrink-0 leading-none text-stone-300 hover:text-blue-600 transition">
      <CameraIcon size={14} />
    </button>
  );

  return (
    <div className={'bg-white border-2 rounded-2xl shadow-sm flex flex-col overflow-hidden ' + meta.cls + (hidden ? ' opacity-60' : '')}>
      <div className="p-3 flex flex-col gap-1.5">
        {/* headline: route + flight no + aircraft + pill, with the box-less star.
            Only this row shares its width with the icons. The date/time row is
            a sibling spanning the full card, so long-haul times such as
            "12:25–09:10+1 · 12h45" never wrap under the date on a 300px card.
            flex-1 (not shrink-to-content) matters for the image export: the
            rasteriser copies computed widths onto its clone and draws text a
            hair wider, so a block sized exactly to its text wraps and
            overflows there. Slack prevents that. */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
            <span className="font-mono font-medium text-[19px] leading-none tracking-tight">
              {flight.origin}<span className="text-stone-300">→</span>{flight.destination}
            </span>
            <span className="font-mono text-[11px] leading-none tnum">
              <span className="text-stone-800 font-medium">{fnNum}</span>
              {flight.equipment && <span className="text-stone-400">({flight.equipment})</span>}
            </span>
            <span className={'font-mono text-[11px] font-medium px-2 py-0.5 rounded-md ' + meta.pill}>{pillLabel}</span>
            {hidden && <span className="text-[9px] font-semibold text-stone-400 uppercase">hidden</span>}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            {!snapshot && actions?.onRefresh && (
              <button onClick={() => actions.onRefresh(flight)} aria-label={`Refresh ${flight.flightNo}`} title={`Refresh ${flight.flightNo}`}
                className="leading-none text-[17px] text-stone-300 hover:text-blue-600 transition">
                <span aria-hidden="true">↻</span>
              </button>
            )}
            {snapshot ? (
              starred && <span className="leading-none text-[18px] text-amber-600" aria-hidden="true">★</span>
            ) : (
              <button onClick={onToggleStar} aria-label={starred ? 'Unstar flight' : 'Star flight'} aria-pressed={starred}
                className={'leading-none text-[18px] transition ' +
                  (starred ? 'text-amber-600' : 'text-stone-300 hover:text-amber-500')}>
                <span aria-hidden="true">{starred ? '★' : '☆'}</span>
              </button>
            )}
          </div>
        </div>
        <div className="text-[13px] text-stone-500 -mt-0.5 flex items-center gap-2 flex-wrap leading-tight">
          <span>{dateShort}</span>
          {flight.depTime && flight.arrTime && (
            <span className="font-mono text-[11px] tnum text-stone-400">
              <span className="text-stone-800">{flight.depTime}</span>–{flight.arrTime}{flight.arrDayOffset > 0 && '+' + flight.arrDayOffset}
              {durStr && <span> · {durStr}</span>}
            </span>
          )}
        </div>

        {/* loads: free row + details toggle on the same line; cap/bkd appear when open */}
        {hasCabins ? (
          <div className="mt-1.5">
            <div className="flex items-start justify-between gap-2">
              <CabinStrip cabins={flight.cabins} expanded={open} queue={result.badge !== null ? result.badge : (flight.queue ? flight.queue.length : null)} />
              {detailsToggle('leading-none mt-0.5')}
            </div>
            <div className="font-mono text-[10px] text-stone-400 tnum mt-1.5 flex items-center justify-between gap-2">
              <span>
                {result.seats.total} seats · {result.seats.premiumTotal} premium
                {flight.observedAt && (
                  <span title={'Loads captured ' + new Date(flight.observedAt).toLocaleString('en-GB')}>
                    {' · '}{fmtStamp(flight.observedAt)}
                  </span>
                )}
              </span>
              {snapshotBtn}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1.5">
            <span className="font-mono text-[11px] text-stone-400">no loads yet</span>
            <span className="flex items-center gap-2">{snapshotBtn}{detailsToggle()}</span>
          </div>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3">
          {flight.queue.length > 0
            ? <QueueTable result={result} myCode={myCode} confirmedSet={confirmedSet} onToggleConfirm={onToggleConfirm} readOnly={snapshot} />
            : <p className="text-[11px] text-stone-400 mt-1 border-t border-stone-100 pt-2">No queue data yet.</p>}
          {!snapshot && actions && <FlightActions flight={flight} hidden={hidden} actions={actions} />}
        </div>
      )}
    </div>
  );
}

function FlightActions({ flight, hidden, actions }) {
  const [pick, setPick] = useState(false);
  const btn = 'text-[11px] font-semibold transition';
  if (actions.mode === 'custom') {
    return (
      <div className="mt-3 border-t border-stone-100 pt-2 flex justify-end">
        <button onClick={() => actions.onRemoveFromGroup(flight)}
          className={btn + ' text-stone-400 hover:text-rose-600'}>Remove from group</button>
      </div>
    );
  }
  // trip mode
  const groups = actions.customGroups || [];
  return (
    <div className="mt-3 border-t border-stone-100 pt-2 flex items-center justify-end gap-3 flex-wrap">
      {groups.length > 0 && (
        pick ? (
          <span className="flex items-center gap-1.5 text-[11px]">
            <span className="text-stone-400">Add to:</span>
            {groups.map((g) => (
              <button key={g.id} onClick={() => { actions.onAddToGroup(flight, g.id); setPick(false); }}
                className={btn + ' text-blue-600 hover:text-blue-700 border border-blue-200 rounded-full px-2 py-0.5'}>{g.name}</button>
            ))}
            <button onClick={() => setPick(false)} className="text-stone-400">×</button>
          </span>
        ) : (
          <button onClick={() => setPick(true)} className={btn + ' text-stone-500 hover:text-blue-600'}>＋ group</button>
        )
      )}
      {hidden
        ? <button onClick={() => actions.onRestore(flight)} className={btn + ' text-blue-600 hover:text-blue-700'}>Restore</button>
        : <button onClick={() => actions.onHide(flight)} className={btn + ' text-stone-400 hover:text-rose-600'}>Delete flight</button>}
    </div>
  );
}
