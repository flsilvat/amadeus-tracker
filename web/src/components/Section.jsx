import { FlightCard } from './cards.jsx';

export const CARD_W = 300; // fixed card width on desktop; phone uses one full-width column

export default function Section({ title, flights, cols, isPhone, app, myCode, myDoj }) {
  if (flights.length === 0) return null;
  const gridStyle = isPhone
    ? { display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }
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
    <div className="mb-7">
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
            />
          );
        })}
      </div>
    </div>
  );
}
