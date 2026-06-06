import { useState } from 'react';
import { enqueueCreateGroup } from '../lib/commands.js';

const airport = (s) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
const STF_RE = /^\d+[A-Z]?\/[FJM]\d*$/i;
const DOJ_RE = /^\d{2}[A-Z]{3}\d{2}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function AddTrip({ onClose, onQueued }) {
  const [name, setName] = useState('');
  const [oOrigin, setOOrigin] = useState('LHR');
  const [oDest, setODest] = useState('');
  const [oDate, setODate] = useState('');
  const [ret, setRet] = useState(true);
  const [iDate, setIDate] = useState('');
  const [code, setCode] = useState('');
  const [doj, setDoj] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const valid =
    oOrigin.length === 3 && oDest.length === 3 && DATE_RE.test(oDate) &&
    (!ret || DATE_RE.test(iDate)) &&
    (!code || STF_RE.test(code.trim())) &&
    (!doj || DOJ_RE.test(doj.trim()));

  const submit = async () => {
    setErr('');
    if (!valid) { setErr('Check the highlighted fields (3-letter airports, valid dates, code like 21/J19).'); return; }
    setBusy(true);
    try {
      const outbound = { origin: oOrigin, destination: oDest, date: oDate };
      const inbound = ret ? { origin: oDest, destination: oOrigin, date: iDate } : undefined;
      const tripName = name.trim() || `${oOrigin}\u2192${oDest} ${oDate}`;
      await enqueueCreateGroup({
        name: tripName, outbound, inbound,
        myStfCode: code.trim() || undefined,
        myDoj: doj.trim().toUpperCase() || undefined,
      });
      onQueued && onQueued(tripName);
      onClose && onClose();
    } catch (e) {
      setErr((e && e.message) || 'Could not queue the trip.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'border border-stone-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400';
  const lbl = 'text-[10px] font-semibold text-stone-500 uppercase tracking-wide';

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold">Add a trip</h2>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 text-sm">Cancel</button>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={lbl}>Trip name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seattle · late July" className={field} />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={lbl}>From</span>
            <input value={oOrigin} onChange={(e) => setOOrigin(airport(e.target.value))} placeholder="LHR" className={'font-mono w-20 ' + field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={lbl}>To</span>
            <input value={oDest} onChange={(e) => setODest(airport(e.target.value))} placeholder="SEA" className={'font-mono w-20 ' + field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={lbl}>Out date</span>
            <input type="date" value={oDate} onChange={(e) => setODate(e.target.value)} className={'font-mono ' + field} />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" checked={ret} onChange={(e) => setRet(e.target.checked)} />
          Return flight
        </label>
        {ret && (
          <div className="flex flex-wrap items-end gap-3 pl-1">
            <div className="flex flex-col gap-1">
              <span className={lbl}>Return</span>
              <span className="font-mono text-sm text-stone-500 py-1.5">{oDest || '—'}{'\u2192'}{oOrigin || '—'}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className={lbl}>Back date</span>
              <input type="date" value={iDate} onChange={(e) => setIDate(e.target.value)} className={'font-mono ' + field} />
            </label>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={lbl}>Pass code (optional)</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="21/J19" className={'font-mono w-24 ' + field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={lbl}>DOJ (optional)</span>
            <input value={doj} onChange={(e) => setDoj(e.target.value)} placeholder="15JUN18" className={'font-mono w-24 ' + field} />
          </label>
        </div>

        {err && <p className="text-xs text-rose-600">{err}</p>}

        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={busy || !valid}
            className="btn-ink rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50">
            {busy ? 'Queuing…' : 'Queue trip'}
          </button>
          <span className="text-[11px] text-stone-400">Runs when your work PC is online.</span>
        </div>
      </div>
    </div>
  );
}
