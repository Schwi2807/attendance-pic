// ─────────────────────────────────────────────────────────────────────────────
// Bus layout engine.
//
// A bus layout is a plain JSON config. Everything else — the seat list, seat
// labels, seat IDs, capacity and drawing geometry — is a pure function of that
// config. The SVG renderer (ui/bus-svg.js) and the PDF seat maps (io/pdf.js)
// both consume `computeGeometry()`, so what you see is what gets printed.
//
// Config shape:
//   {
//     deckType:   'single' | 'double',
//     driverSide: 'right' | 'left',        // right = Malaysia/UK (door on the left)
//     decks: {
//       L: { layout: '2-2', rows: 10, backBench: false },   // lower / only deck
//       U: { layout: '2-2', rows: 10, backBench: false },   // upper (double only)
//     }
//   }
//
// Seat IDs are stable and unique within an event: "<busId>.<deck>.<row><letter>"
// e.g. "bus_3f9c….L.3C". A single-decker uses deck "L" internally so switching
// to a double-decker keeps every existing seat ID. Labels shown to people are
// "3C" (single deck) or "L3C" / "U3C" (double-decker).
// ─────────────────────────────────────────────────────────────────────────────

export const LAYOUTS = {
  '2-2': { left: 2, right: 2, seatAcross: 46, hint: 'Standard coach' },
  '2-3': { left: 2, right: 3, seatAcross: 41, hint: 'High capacity' },
  '1-2': { left: 1, right: 2, seatAcross: 54, hint: 'VIP / executive' },
  '1-3': { left: 1, right: 3, seatAcross: 46, hint: 'Mixed' },
};
export const LAYOUT_KEYS = Object.keys(LAYOUTS);
export const MIN_ROWS = 1;
export const MAX_ROWS = 20;
export const DECK_NAMES = { L: 'Lower', U: 'Upper' };
const LETTERS = 'ABCDEFGH';

export const DEFAULT_DECK = Object.freeze({ layout: '2-2', rows: 10, backBench: false });
export const DEFAULT_TEMPLATE = Object.freeze({
  deckType: 'single',
  driverSide: 'right',
  decks: { L: { ...DEFAULT_DECK }, U: { ...DEFAULT_DECK } },
});

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function normalizeDeck(d) {
  return {
    layout: LAYOUTS[d?.layout] ? d.layout : DEFAULT_DECK.layout,
    rows: clampInt(d?.rows, MIN_ROWS, MAX_ROWS, DEFAULT_DECK.rows),
    backBench: Boolean(d?.backBench),
  };
}

/** Returns a complete, valid config (never mutates the input). */
export function normalizeConfig(cfg = {}) {
  return {
    deckType: cfg.deckType === 'double' ? 'double' : 'single',
    driverSide: cfg.driverSide === 'left' ? 'left' : 'right',
    decks: { L: normalizeDeck(cfg.decks?.L), U: normalizeDeck(cfg.decks?.U ?? cfg.decks?.L) },
  };
}

export function activeDeckKeys(cfg) {
  return cfg.deckType === 'double' ? ['L', 'U'] : ['L'];
}

export const makeSeatId = (busId, deck, row, letter) => `${busId}.${deck}.${row}${letter}`;

export function parseSeatId(seatId) {
  const m = /^(.+)\.([LU])\.(\d+)([A-H])$/.exec(seatId || '');
  return m ? { busId: m[1], deck: m[2], row: Number(m[3]), letter: m[4] } : null;
}

/** Letters for one row, left to right as seen facing forward. */
export function rowLetters(layoutKey, bench = false) {
  const { left, right } = LAYOUTS[layoutKey];
  return LETTERS.slice(0, left + right + (bench ? 1 : 0)).split('');
}

/**
 * All seats of a bus in fill order: lower deck first, front to back,
 * left to right within a row. Pure; no geometry.
 */
export function enumerateSeats(busId, rawCfg) {
  const cfg = normalizeConfig(rawCfg);
  const double = cfg.deckType === 'double';
  const seats = [];
  for (const deck of activeDeckKeys(cfg)) {
    const d = cfg.decks[deck];
    for (let row = 1; row <= d.rows; row++) {
      const bench = d.backBench && row === d.rows;
      rowLetters(d.layout, bench).forEach((letter, col) => {
        seats.push({
          id: makeSeatId(busId, deck, row, letter),
          label: `${double ? deck : ''}${row}${letter}`,
          deck,
          row,
          letter,
          col,
          bench,
          index: seats.length,
        });
      });
    }
  }
  return seats;
}

export function seatCount(rawCfg) {
  const cfg = normalizeConfig(rawCfg);
  return activeDeckKeys(cfg).reduce((sum, k) => {
    const d = cfg.decks[k];
    const { left, right } = LAYOUTS[d.layout];
    return sum + d.rows * (left + right) + (d.backBench ? 1 : 0);
  }, 0);
}

// ── Geometry ────────────────────────────────────────────────────────────────
// Local coordinates per deck: `along` runs from the nose (0) to the rear,
// `across` runs from the bus's LEFT side (0) to its right side, both in
// abstract px. Screen mapping (which way the bus faces) happens in
// `toScreen()` so renderers never need to think about flipping.

export const GEO = {
  pitch: 62, // row spacing along the bus
  seatLen: 52, // seat size along the bus
  gap: 4, // gap between neighbouring seats across the bus
  minAisle: 30,
  wall: 9, // body wall + inner padding
  frontSingle: 116, // nose + driver + door
  frontDouble: 178, // … + stairs
  rear: 34,
  margin: 14, // room around the body for wheels and mirrors
  labelH: 26, // deck label strip above each deck
  deckGap: 10,
};

function deckSeatSpan(d) {
  const { left, right, seatAcross } = LAYOUTS[d.layout];
  return (left + right) * seatAcross + (left - 1 + right - 1) * GEO.gap;
}

/**
 * Full drawing geometry for one bus. Both decks of a double-decker share one
 * body length and width (it is one vehicle); a deck with fewer rows gets an
 * open area at the rear (luggage / standing space).
 */
export function computeGeometry(busId, rawCfg) {
  const cfg = normalizeConfig(rawCfg);
  const keys = activeDeckKeys(cfg);
  const double = cfg.deckType === 'double';
  const front = double ? GEO.frontDouble : GEO.frontSingle;

  const inner = Math.max(...keys.map((k) => deckSeatSpan(cfg.decks[k]) + GEO.minAisle));
  const W = inner + GEO.wall * 2;
  const L = front + Math.max(...keys.map((k) => cfg.decks[k].rows)) * GEO.pitch + GEO.rear;
  const seatsAll = enumerateSeats(busId, cfg);
  const driverAcross = cfg.driverSide === 'right' ? 'right' : 'left';
  const doorSide = driverAcross === 'right' ? 'left' : 'right';
  // `across` position of a box of width w hugging a side of the bus.
  const hug = (side, w, inset = GEO.wall) => (side === 'left' ? inset : W - inset - w);

  const decks = keys.map((key) => {
    const d = cfg.decks[key];
    const { left, right, seatAcross: sa } = LAYOUTS[d.layout];
    const aisle = inner - deckSeatSpan(d);
    const seats = seatsAll
      .filter((s) => s.deck === key)
      .map((s) => {
        const along = front + (s.row - 1) * GEO.pitch + (GEO.pitch - GEO.seatLen) / 2;
        let across;
        let w = sa;
        if (s.bench) {
          // Back bench: seats spread evenly over the full width, aisle filled.
          const n = left + right + 1;
          w = (inner - (n - 1) * GEO.gap) / n;
          across = GEO.wall + s.col * (w + GEO.gap);
        } else if (s.col < left) {
          across = GEO.wall + s.col * (sa + GEO.gap);
        } else {
          across = GEO.wall + left * sa + (left - 1) * GEO.gap + aisle + (s.col - left) * (sa + GEO.gap);
        }
        return { ...s, along, across, len: GEO.seatLen, wid: w };
      });

    const rowsEnd = front + d.rows * GEO.pitch;
    const isLower = key === 'L';
    const parts = {
      windscreen: { along: 3, across: GEO.wall - 2, len: 14, wid: W - (GEO.wall - 2) * 2 },
      aisle: {
        along: front - 6,
        across: GEO.wall + left * sa + (left - 1) * GEO.gap + 3,
        len: rowsEnd - front + 6 - (d.backBench ? GEO.pitch : 0),
        wid: aisle - 6,
      },
      stairs: double ? { along: 104, across: hug(doorSide, 2 * 40 + GEO.gap), len: 58, wid: 2 * 40 + GEO.gap } : null,
      openArea: rowsEnd < L - GEO.rear - 4 ? { along: rowsEnd + 6, across: GEO.wall + 4, len: L - GEO.rear - rowsEnd - 10, wid: inner - 8 } : null,
      driver: null,
      wheel: null,
      door: null,
      dashboard: null,
    };
    if (isLower) {
      parts.dashboard = { along: 19, across: GEO.wall + 4, len: 8, wid: inner - 8 };
      parts.driver = { along: 44, across: hug(driverAcross, 44, GEO.wall + 6), len: 46, wid: 44 };
      parts.wheel = {
        cx: 36,
        cy: parts.driver.across + 22,
        r: 13,
      };
      parts.door = { along: 28, across: doorSide === 'left' ? 0 : W - GEO.wall, len: 66, wid: GEO.wall };
    }
    return { key, name: DECK_NAMES[key], double, layout: d.layout, rows: d.rows, backBench: d.backBench, seats, parts };
  });

  // Axles (shared by both decks visually; drawn on every deck for realism).
  const axles = [front > 150 ? 70 : 64, L - GEO.rear - GEO.pitch * 1.6];

  return {
    busId,
    config: cfg,
    L,
    W,
    front,
    decks,
    axles,
    driverSide: cfg.driverSide,
    doorSide,
    // Overall drawing size (unscaled) for one deck block and all decks stacked.
    deckBlock: { width: L + GEO.margin * 2, height: GEO.labelH + W + GEO.margin * 2 },
    size: {
      width: L + GEO.margin * 2,
      height: decks.length * (GEO.labelH + W + GEO.margin * 2) + (decks.length - 1) * GEO.deckGap,
    },
  };
}

/**
 * Maps a local box {along, across, len, wid} to a screen rect {x, y, w, h}
 * inside a deck block whose top-left is (ox, oy).
 *
 * Facing left (default): nose on the left, bus's LEFT side at the bottom —
 * exactly what you see looking down on a bus driving towards the left edge.
 * Flipped: rotated 180° (nose on the right, left side at the top).
 */
export function toScreen(box, geo, flipped, ox = 0, oy = 0) {
  const m = GEO.margin;
  const top = oy + GEO.labelH + m;
  if (!flipped) {
    return { x: ox + m + box.along, y: top + (geo.W - box.across - box.wid), w: box.len, h: box.wid };
  }
  return { x: ox + m + (geo.L - box.along - box.len), y: top + box.across, w: box.len, h: box.wid };
}

export function toScreenPoint(along, across, geo, flipped, ox = 0, oy = 0) {
  const r = toScreen({ along, across, len: 0, wid: 0 }, geo, flipped, ox, oy);
  return { x: r.x, y: r.y };
}

// ── Bus names ───────────────────────────────────────────────────────────────
const WORDS = [
  'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
];
export const numberWord = (n) => WORDS[n - 1] || `Bus ${n}`;

/** Lowest default name ("One", "Two", …) not already used. */
export function nextBusName(existingNames) {
  const used = new Set(existingNames.map((s) => String(s).trim().toLowerCase()));
  for (let n = 1; n < 500; n++) {
    const w = numberWord(n);
    if (!used.has(w.toLowerCase())) return w;
  }
  return `Bus ${existingNames.length + 1}`;
}

export function describeConfig(rawCfg) {
  const cfg = normalizeConfig(rawCfg);
  const deckText = (k) => {
    const d = cfg.decks[k];
    return `${d.layout} × ${d.rows}${d.backBench ? ' + bench' : ''}`;
  };
  return cfg.deckType === 'double' ? `Double-decker · L ${deckText('L')} · U ${deckText('U')}` : `Single deck · ${deckText('L')}`;
}
