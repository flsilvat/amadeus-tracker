import { useMemo } from 'react';
import { computeOdds, paxKey, ODDS_META, statusLabel } from '../lib/odds.js';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CabinStrip({ cabins }) {
  const order = ['F', 'J', 'W', 'M'].filter((c) => cabins[c]);
  return (
    <div className="flex items-center gap-2.5 font-mono text-[12px] tnum min-w-0">
      {order.map((c) => {
        const net = cabins[c].capacity - cabins[c].booked;
        const over = net < 0;
        const club = c === 'J';
        return (
          <span key={c} className="flex items-baseline gap-0.5">
            <span className={'text-[10px] ' + (club ? 'text-blue-500' : 'text-stone-400')}>{c}</span>
            <span className={'font-bold ' + (over ? 'text-rose-600' : club ? 'text-blue-700' : 'text-stone-700')}>{net}</span>
          </span>
        );
      })}
    </div>
  );
}

export function CabinDetail({ cabins }) {
  const order = ['F', 'J', 'W', 'M'].filter((c) => cabins[c]);
  const names = { F: 'First', J: 'Club', W: 'Eco+', M: 'Eco' };
  return (
    <div className="font-mono text-[11px] tnum grid gap-x-4 gap-y-1 items-baseline"
      style={{ gridTemplateColumns: '1fr auto auto auto' }}>
      <span className="text-stone-400">cabin</span>
      <span className="text-stone-400 text-right">CAP</span>
      <span className="text-stone-400 text-right">BC</span>
      <span className="text-stone-400 text-right">AVA</span>
      {order.map((c) => {
        const cap = cabins[c].capacity, bc = cabins[c].booked, adj = cabins[c].adj || 0;
        const ava = cap - bc;
        const club = c === 'J';
        return (
          <Fragmentish key={c}>
            <span className={club ? 'text-blue-700 font-bold' : 'text-stone-600'}>{names[c]}</span>
            <span className="text-right text-stone-700">
              {cap}{adj !== 0 && <span className="text-stone-400"> ({adj > 0 ? '+' + adj : adj})</span>}
            </span>
            <span className="text-right text-stone-700">{bc}</span>
            <span className={'text-right font-bold ' + (ava < 0 ? 'text-rose-600' : club ? 'text-blue-700' : 'text-stone-800')}>{ava}</span>
          </Fragmentish>
        );
      })}
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
    <div className="mt-3 border-t border-stone-100 pt-2">
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

export function FlightCard({ flight, myCode, myDoj, confirmedSet, onToggleConfirm, starred, onToggleStar, open, onToggleOpen }) {
  const result = useMemo(() => computeOdds(flight, myCode, myDoj, confirmedSet), [flight, myCode, myDoj, confirmedSet]);
  const meta = ODDS_META[result.color];
  const fnDisplay = flight.flightNo.slice(0, 2) + ' ' + (+flight.flightNo.slice(2));
  const dirArrow = flight.direction === 'outbound' ? '↗' : '↘';
  const dateShort = +flight.isoDate.slice(8) + ' ' + MONTHS[+flight.isoDate.slice(5, 7)];
  const durStr = flight.durationMin
    ? Math.floor(flight.durationMin / 60) + 'h ' + String(flight.durationMin % 60).padStart(2, '0') + 'm'
    : null;

  return (
    <div className={'bg-white border-2 rounded-2xl shadow-sm flex flex-col overflow-hidden ' + meta.cls}>
      <div className="p-2.5 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-mono font-bold text-base leading-none">{fnDisplay}</span>
            <span className="font-mono text-[10px] text-stone-400">{flight.equipment}</span>
            <span className="text-stone-300 text-xs">{dirArrow}</span>
          </div>
          <button onClick={onToggleStar} aria-label={starred ? 'Unstar flight' : 'Star flight'}
            aria-pressed={starred}
            className={'shrink-0 flex items-center justify-center rounded-full w-7 h-7 leading-none transition ' +
              (starred
                ? 'bg-amber-400 text-white shadow-sm ring-2 ring-amber-200'
                : 'text-stone-300 hover:text-amber-400 hover:bg-amber-50')}>
            <span className="text-sm leading-none">{starred ? '★' : '☆'}</span>
          </button>
        </div>

        <div className="font-mono text-xs tnum flex items-center gap-1.5 flex-wrap leading-tight">
          <span className="font-bold text-stone-800">{flight.origin}</span>
          <span className="text-stone-600">{flight.depTime}</span>
          <span className="text-stone-300">→</span>
          <span className="font-bold text-stone-800">{flight.destination}</span>
          <span className="text-stone-600">{flight.arrTime}</span>
          {flight.arrDayOffset > 0 && <span className="text-[9px] text-stone-400 self-start">+{flight.arrDayOffset}</span>}
        </div>

        <div className="font-mono text-[11px] text-stone-400 tnum flex items-center gap-1.5 leading-tight">
          <span>{dateShort}</span>
          {durStr && <><span className="text-stone-300">·</span><span>{durStr}</span></>}
        </div>

        <div className="flex items-center justify-between gap-2 mt-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={'text-[11px] font-semibold px-2 py-0.5 rounded-md border truncate ' + meta.pill}>
              {statusLabel(result.color, result.myCabin)}
            </span>
            {flight.observedAt && (
              <span className="font-mono text-[9px] text-stone-400 tnum whitespace-nowrap shrink-0"
                title={'Loads captured ' + new Date(flight.observedAt).toLocaleString('en-GB')}>
                {fmtStamp(flight.observedAt)}
              </span>
            )}
          </div>
          <button onClick={onToggleOpen}
            className="relative shrink-0 text-[11px] font-semibold btn-ink rounded-lg px-2.5 py-1 transition flex items-center gap-1.5">
            <span>Queue</span>
            {result.badge !== null && (
              <span className="badge-pink text-white rounded-full text-[10px] font-bold min-w-[18px] h-[18px] px-1 flex items-center justify-center tnum">
                {result.badge}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <CabinStrip cabins={flight.cabins} />
          <span className="text-[10px] text-stone-400 tnum shrink-0">{result.seats.total}s · {result.seats.premiumTotal}p</span>
        </div>
      </div>

      {open && (
        <div className="px-2.5 pb-2.5">
          {Object.keys(flight.cabins).length > 0 && (
            <div className="border-t border-stone-100 pt-2">
              <CabinDetail cabins={flight.cabins} />
            </div>
          )}
          {flight.queue.length > 0
            ? <QueueTable result={result} myCode={myCode} confirmedSet={confirmedSet} onToggleConfirm={onToggleConfirm} />
            : <p className="text-[11px] text-stone-400 mt-3 border-t border-stone-100 pt-2">No queue data yet.</p>}
        </div>
      )}
    </div>
  );
}
