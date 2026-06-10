import { useMemo, useState } from 'react';
import { computeOdds, paxKey, ODDS_META } from '../lib/odds.js';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CABIN_SHORT = { F: 'First', J: 'Club', W: 'Eco+', M: 'Eco' };

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


// Compact "last updated" stamp: time only if today (e.g. "14:32"),
// otherwise day + time (e.g. "7 Jun 14:32").
function fmtStamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? hm
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + hm;
}

export function QueueTable({ result, myCode, confirmedSet, onToggleConfirm }) {
  const { queue, dividerIndex, meKeys = new Set() } = result;
  const matched = meKeys.size > 0;
  const Divider = () => (
    <tr>
      <td colSpan="6" className="py-1">
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
            <th className="w-6"></th><th>Name</th><th>Cab</th><th>PNR</th><th>Code</th><th>DOJ</th>
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
                  <td className="text-center">
                    <input type="checkbox" checked={confirmed} onChange={() => onToggleConfirm(k)}
                      title="Mark confirmed (remove from queue + odds)" />
                  </td>
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

export function FlightCard({ flight, myCode, myDoj, confirmedSet, onToggleConfirm, starred, onToggleStar, open, onToggleOpen, actions }) {
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

  return (
    <div className={'bg-white border-2 rounded-2xl shadow-sm flex flex-col overflow-hidden ' + meta.cls + (hidden ? ' opacity-60' : '')}>
      <div className="p-3 flex flex-col gap-1.5">
        {/* headline: route + flight no + aircraft + pill, with the box-less star */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
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
            <div className="text-[13px] text-stone-500 mt-1 flex items-center gap-2 flex-wrap leading-tight">
              <span>{dateShort}</span>
              {flight.depTime && flight.arrTime && (
                <span className="font-mono text-[11px] tnum text-stone-400">
                  <span className="text-stone-800">{flight.depTime}</span>–{flight.arrTime}{flight.arrDayOffset > 0 && '+' + flight.arrDayOffset}
                  {durStr && <span> · {durStr}</span>}
                </span>
              )}
            </div>
          </div>
          <button onClick={onToggleStar} aria-label={starred ? 'Unstar flight' : 'Star flight'} aria-pressed={starred}
            className={'shrink-0 leading-none text-[18px] transition ' +
              (starred ? 'text-amber-600' : 'text-stone-300 hover:text-amber-500')}>
            <span aria-hidden="true">{starred ? '★' : '☆'}</span>
          </button>
        </div>

        {/* loads: free row + details toggle on the same line; cap/bkd appear when open */}
        {hasCabins ? (
          <div className="mt-1.5">
            <div className="flex items-start justify-between gap-2">
              <CabinStrip cabins={flight.cabins} expanded={open} queue={result.badge !== null ? result.badge : (flight.queue ? flight.queue.length : null)} />
              <button onClick={onToggleOpen}
                className="shrink-0 font-mono text-[11px] text-stone-400 hover:text-stone-700 transition flex items-center gap-1 leading-none mt-0.5">
                details <span aria-hidden="true">{open ? '▴' : '▾'}</span>
              </button>
            </div>
            <div className="font-mono text-[10px] text-stone-400 tnum mt-1.5">
              {result.seats.total} seats · {result.seats.premiumTotal} premium
              {flight.observedAt && (
                <span title={'Loads captured ' + new Date(flight.observedAt).toLocaleString('en-GB')}>
                  {' · '}{fmtStamp(flight.observedAt)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-1.5">
            <span className="font-mono text-[11px] text-stone-400">no loads yet</span>
            <button onClick={onToggleOpen}
              className="font-mono text-[11px] text-stone-400 hover:text-stone-700 transition flex items-center gap-1">
              details <span aria-hidden="true">{open ? '▴' : '▾'}</span>
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="px-3 pb-3">
          {flight.queue.length > 0
            ? <QueueTable result={result} myCode={myCode} confirmedSet={confirmedSet} onToggleConfirm={onToggleConfirm} />
            : <p className="text-[11px] text-stone-400 mt-1 border-t border-stone-100 pt-2">No queue data yet.</p>}
          {actions && <FlightActions flight={flight} hidden={hidden} actions={actions} />}
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
