import { FlightCard } from './cards.jsx';

export const CARD_W = 300; // fixed card width on desktop; phone uses one full-width column

export default function Section({ title, flights, cols, isPhone, inline = false, app, myCode, myDoj }) {
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
      <h2 className="text-xs font-bold text-stone-500 uppercase tracking-wide mb-2.5">{title}</h2>
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
