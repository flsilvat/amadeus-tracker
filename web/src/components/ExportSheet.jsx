import { useEffect } from 'react';
import { FlightCard } from './cards.jsx';
import { CARD_W, GAP, PAD, SECTION_GAP, keyOf } from '../lib/exportLayout.js';

// Sheet that the "copy as image" actions render off-screen and rasterise
// (see lib/screenshot.js). Cards are the real FlightCard in snapshot mode:
// no buttons, and the passenger queue only for cards that are open in the UI.
//
//   mode 'phone'    one column at iPhone logical width, so the PNG reads at
//                   full size on a phone without zooming.
//   mode 'desktop'  cards at their desktop width, packed into masonry columns
//                   by a `plan` from planLayout() — a widescreen-ish picture
//                   with little wasted space. Without a plan the sheet renders
//                   a plain measuring stack instead, so the caller can read
//                   each card's height and compute the plan.
export const SHEET_W = 390;        // iPhone 12–15 logical width (pt)
export const SHEET_BG = '#f4f2ec'; // same cream as body in index.css

export default function ExportSheet({ title, sections, mode = 'phone', plan = null, myCode, myDoj, confirmedSetFor, isFavorite, isOpen, onMounted }) {
  // Fires after every commit; the caller awaits it once per render pass.
  useEffect(() => { onMounted?.(); }, [onMounted]);

  const card = (f) => {
    const key = keyOf(f);
    return (
      <FlightCard key={key} snapshot flight={f} myCode={myCode} myDoj={myDoj}
        confirmedSet={confirmedSetFor(key)} starred={isFavorite(key)} open={isOpen(key)} />
    );
  };
  const all = sections.flatMap((s) => s.flights);

  if (mode === 'desktop' && !plan) {
    return (
      <div style={{ width: CARD_W }}>
        {all.map((f) => <div key={keyOf(f)} data-key={keyOf(f)}>{card(f)}</div>)}
      </div>
    );
  }

  const byKey = Object.fromEntries(all.map((f) => [keyOf(f), f]));
  const heading = (t) => t && <h2 className="text-[11px] font-bold text-stone-500 uppercase tracking-wide mb-2">{t}</h2>;
  const masonry = (columns) => (
    <div className="flex items-start" style={{ gap: GAP }}>
      {columns.map((col, i) => (
        <div key={i} className="flex flex-col" style={{ width: CARD_W, gap: GAP }}>{col.map((k) => card(byKey[k]))}</div>
      ))}
    </div>
  );
  const phone = mode === 'phone';
  const blocks = phone ? sections : plan.sections;

  return (
    <div className="font-sans text-stone-800"
      style={{ width: phone ? SHEET_W : plan.width, background: SHEET_BG, padding: `${PAD + 2}px ${PAD}px ${PAD}px`, boxSizing: 'border-box' }}>
      {title && <h1 className="text-[17px] font-bold tracking-tight leading-tight mb-3 break-words">{title}</h1>}
      {!phone && plan.arrangement === 'side' ? (
        <div className="flex items-start" style={{ gap: SECTION_GAP }}>
          {blocks.map((s, i) => <div key={i}>{heading(s.title)}{masonry(s.columns)}</div>)}
        </div>
      ) : (
        blocks.map((s, i) => (
          <div key={i} className={i < blocks.length - 1 ? 'mb-5' : ''}>
            {heading(s.title)}
            {phone
              ? <div className="flex flex-col" style={{ gap: GAP }}>{s.flights.map(card)}</div>
              : masonry(s.columns)}
          </div>
        ))
      )}
      {myCode && (
        <p className="font-mono text-[10px] text-stone-400 tnum mt-3">
          odds for {myCode}{myDoj ? ' · DOJ ' + myDoj : ''}
        </p>
      )}
    </div>
  );
}
