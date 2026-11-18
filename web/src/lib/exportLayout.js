// =============================================================================
// Desktop layout planner for the image export (pure — no DOM, no React).
//
// Given the sections and each card's measured height at CARD_W, pick the
// arrangement whose picture is closest to a widescreen (16:9) frame while
// wasting the least space. Candidates:
//   stacked  sections one under another, every section packed into the same
//            N masonry columns (N = 1..MAX_COLS);
//   side     exactly two sections next to each other, each with its own
//            column count.
// Within a section, cards are packed two ways and the shorter result wins:
// greedy masonry (each card into the shortest column — plain row order when
// heights are equal) or contiguous runs (read each column top to bottom),
// which balances better when an open card is much taller than closed ones.
// =============================================================================

export const CARD_W = 300;      // desktop card width; same as Section.jsx CARD_W
export const GAP = 12;          // between cards, both axes
export const PAD = 12;          // sheet padding
export const SECTION_GAP = 28;  // between side-by-side sections
const SECTION_VGAP = 20;        // between stacked sections (mb-5)
const TITLE_H = 36;             // sheet chrome, approximate — used for scoring only
const HEADING_H = 24;
const FOOTER_H = 26;
const TARGET_RATIO = 16 / 9;
const MAX_COLS = 5;
const TALL_WEIGHT = 0.6;        // a portrait picture gets scaled down hard on a desktop screen…
const WIDE_WEIGHT = 0.3;        // …a wide one just uses the window width

export const keyOf = (f) => `${f.flightNo}_${f.isoDate}`;

function packGreedy(keys, h, cols) {
  const columns = Array.from({ length: cols }, () => []);
  const tall = new Array(cols).fill(0);
  keys.forEach((k, idx) => {
    let i = 0;
    for (let j = 1; j < cols; j++) if (tall[j] < tall[i]) i = j;
    tall[i] += (columns[i].length ? GAP : 0) + h[idx];
    columns[i].push(k);
  });
  return { columns: columns.filter((c) => c.length), height: Math.max(0, ...tall) };
}

// Split the sequence into `cols` contiguous non-empty runs minimising the
// tallest run (classic partition DP; n and cols are tiny).
function packContiguous(keys, h, cols) {
  const n = keys.length;
  const c = Math.min(cols, n);
  const pre = [0];
  h.forEach((x) => pre.push(pre[pre.length - 1] + x));
  const run = (s, e) => pre[e] - pre[s] + (e - s - 1) * GAP;
  const best = Array.from({ length: c + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: c + 1 }, () => new Array(n + 1).fill(0));
  best[0][0] = 0;
  for (let j = 1; j <= c; j++) {
    for (let i = j; i <= n; i++) {
      for (let s = j - 1; s < i; s++) {
        const v = Math.max(best[j - 1][s], run(s, i));
        if (v < best[j][i]) { best[j][i] = v; cut[j][i] = s; }
      }
    }
  }
  const columns = [];
  for (let j = c, i = n; j >= 1; j--) { const s = cut[j][i]; columns.unshift(keys.slice(s, i)); i = s; }
  return { columns, height: best[c][n] };
}

function pack(keys, heights, cols) {
  if (!keys.length) return { columns: [], height: 0 };
  const h = keys.map((k) => heights[k] || 200);
  const g = packGreedy(keys, h, cols);
  const s = packContiguous(keys, h, cols);
  return s.height < g.height - 1 ? s : g; // keep row order unless the split is really shorter
}

// fill = card area / area of the column grids (holes count against it);
// the shape term is in log space, so 2x too wide costs the same as 2x too
// tall before the weights.
function score(cardArea, gridArea, width, height) {
  const fill = gridArea > 0 ? cardArea / gridArea : 0;
  const dev = Math.log((width / height) / TARGET_RATIO);
  return fill - (dev < 0 ? TALL_WEIGHT : WIDE_WEIGHT) * Math.abs(dev);
}

/**
 * @param sections [{ title, flights }]
 * @param heights  { [keyOf(flight)]: px } measured at CARD_W
 * @returns { arrangement: 'stacked'|'side', width, height, sections: [{ title, columns: [[key…]…] }] }
 */
export function planLayout(sections, heights, { title = true, footer = true } = {}) {
  const secs = sections.filter((s) => s.flights.length);
  const keysOf = (s) => s.flights.map(keyOf);
  const chrome = PAD * 2 + (title ? TITLE_H : 0) + (footer ? FOOTER_H : 0);
  const cardArea = secs.flatMap(keysOf).reduce((a, k) => a + CARD_W * (heights[k] || 200), 0);
  const candidates = [];

  const maxLen = Math.max(0, ...secs.map((s) => s.flights.length));
  for (let c = 1; c <= Math.min(MAX_COLS, maxLen); c++) {
    const packed = secs.map((s) => ({ title: s.title, ...pack(keysOf(s), heights, c) }));
    const width = PAD * 2 + c * CARD_W + (c - 1) * GAP;
    const height = chrome + packed.reduce((a, p) => a + HEADING_H + p.height, 0) + (packed.length - 1) * SECTION_VGAP;
    const gridArea = packed.reduce((a, p) => a + c * CARD_W * p.height, 0);
    candidates.push({
      arrangement: 'stacked', width, height,
      sections: packed.map((p) => ({ title: p.title, columns: p.columns })),
      score: score(cardArea, gridArea, width, height),
    });
  }

  if (secs.length === 2) {
    const [a, b] = secs;
    for (let ca = 1; ca <= Math.min(MAX_COLS - 1, a.flights.length); ca++) {
      for (let cb = 1; cb <= Math.min(MAX_COLS - ca, b.flights.length); cb++) {
        const pa = pack(keysOf(a), heights, ca);
        const pb = pack(keysOf(b), heights, cb);
        const width = PAD * 2 + (ca + cb) * CARD_W + (ca + cb - 2) * GAP + SECTION_GAP;
        const block = Math.max(pa.height, pb.height);
        const height = chrome + HEADING_H + block;
        candidates.push({
          arrangement: 'side', width, height,
          sections: [{ title: a.title, columns: pa.columns }, { title: b.title, columns: pb.columns }],
          score: score(cardArea, (ca + cb) * CARD_W * block, width, height),
        });
      }
    }
  }

  candidates.sort((x, y) => y.score - x.score);
  return candidates[0] || { arrangement: 'stacked', width: PAD * 2 + CARD_W, height: chrome, sections: [] };
}
