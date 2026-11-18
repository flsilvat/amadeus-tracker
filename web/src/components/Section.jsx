import { FlightCard, CameraIcon } from './cards.jsx';

export const CARD_W = 300; // fixed card width on desktop; phone uses one full-width column

// onSnapshot(title, flights): copy this whole section as one image.
export default function Section({ title, flights, cols, isPhone, inline = false, app, myCode, myDoj, onSnapshot }) {
  if (flights.length === 0) return null;
  const n = flights.length;
  // One-row layout only when the section genuinely fits within the chosen
  // column cap (n <= cols). Beyond that, fall through to the multi-row grid
  // that honours `cols` — otherwise a 4-flight group would ignore "2 columns"
  // and splay all four across one row.
  const oneRow = !isPhone && n <= Math.max(1, cols);
  const gridStyle = isPhone
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }
    : oneRow
    ? {
        display: 'grid',
        gap: '12px',
        gridTemplateColumns: `repeat(${n}, minmax(0, ${CARD_W}px))`,
        justifyContent: 'center',
      }
    : {
        display: 'grid',
        gap: '12px',
        gridTemplateColumns: `repeat(auto-fill, ${CARD_W}px)`,
        justifyContent: 'center',
        maxWidth: cols * CARD_W + (cols - 1) * 12,
        marginLeft: 'auto',
        marginRight: 'auto',
      };
  return (
    // inline: shrinks to content and sits beside the sibling section (the
    // parent flex row centres the pair and wraps on narrow windows)
    <div className="mb-7" style={inline ? { flex: '0 1 auto', minWidth: 0 } : undefined}>
      <div className="flex items-center gap-2 mb-2.5">
        <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wide">{title}</h2>
        {onSnapshot && (
          <button onClick={() => onSnapshot(title, flights)} aria-label={`Copy ${title} as an image`} title="Copy this section as an image"
            className="leading-none text-stone-300 hover:text-blue-600 transition">
            <CameraIcon size={14} />
          </button>
        )}
      </div>
      <div style={gridStyle}>
        {flights.map((f) => {
          const key = `${f.flightNo}_${f.isoDate}`;
          return (
            <FlightCard
              key={key}
              flight={f}
              myCode={myCode}
              myDoj={myDoj}
              confirmedSet={app.confirmedSetFor(key)}
              onToggleConfirm={(paxKey) => app.toggleConfirm(key, paxKey)}
              starred={app.isFavorite(key)}
              onToggleStar={() => app.toggleFavorite(key)}
              open={app.openFlights.has(key)}
              onToggleOpen={() => app.toggleOpen(key)}
              actions={app.flightActions}
            />
          );
        })}
      </div>
    </div>
  );
}
