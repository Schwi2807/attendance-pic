// ─────────────────────────────────────────────────────────────────────────────
// Top-down coach renderer (Redbus-style). Pure function of
// geometry (from the layout engine) + seat states → SVG markup string.
//
// Everything that is not text is positioned with `toScreen()`, so flipping
// the bus is a 180° turn of the layout while labels stay upright.
// ─────────────────────────────────────────────────────────────────────────────

import { GEO, computeGeometry, toScreen, toScreenPoint } from '../domain/layout.js';
import { esc } from './dom.js';
import { shortName } from '../utils/format.js';

const r1 = (n) => Math.round(n * 10) / 10;

/** Rounded-rect path with individual corner radii (tl, tr, br, bl). */
function rrPath(x, y, w, h, tl, tr, br, bl) {
  return `M${r1(x + tl)},${r1(y)}H${r1(x + w - tr)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + tr)}V${r1(y + h - br)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w - br)},${r1(y + h)}H${r1(x + bl)}Q${r1(x)},${r1(y + h)} ${r1(x)},${r1(y + h - bl)}V${r1(y + tl)}Q${r1(x)},${r1(y)} ${r1(x + tl)},${r1(y)}Z`;
}

const rect = (r, cls, rx = 0, extra = '') => `<rect class="${cls}" x="${r1(r.x)}" y="${r1(r.y)}" width="${r1(r.w)}" height="${r1(r.h)}" rx="${rx}" ${extra}/>`;

/**
 * @param {object} bus      { id, name, flipped, config }
 * @param {(seat) => object} seatState  returns { state, name, label, sub, absent, present, selected, kind }
 *   state: 'available' | 'assigned' | 'unavailable' | 'reserved' | 'vip'
 * @param {object} [opts]   { interactive=true, idPrefix }
 */
export function renderBusSVG(bus, seatState, opts = {}) {
  const interactive = opts.interactive !== false;
  const geo = computeGeometry(bus.id, bus.config);
  const flipped = Boolean(bus.flipped);
  const { width, height } = geo.size;
  const blockH = geo.deckBlock.height + GEO.deckGap;
  const parts = [];

  geo.decks.forEach((deck, di) => {
    const oy = di * blockH;
    const T = (box) => toScreen(box, geo, flipped, 0, oy);
    const P = (along, across) => toScreenPoint(along, across, geo, flipped, 0, oy);
    const body = T({ along: 0, across: 0, len: geo.L, wid: geo.W });
    const nose = 34;
    const tail = 14;
    // Front corners are on the left when facing left, right when flipped.
    const bodyPath = flipped ? rrPath(body.x, body.y, body.w, body.h, tail, nose, nose, tail) : rrPath(body.x, body.y, body.w, body.h, nose, tail, tail, nose);
    const g = [];

    // Deck label + direction hint
    const labelY = oy + 17;
    const front = flipped ? 'Front →' : '← Front';
    const deckName = geo.decks.length > 1 ? `${deck.name} deck` : 'Single deck';
    g.push(`<g class="deck-label"><text class="deck-title" x="${GEO.margin}" y="${labelY}">${esc(deckName.toUpperCase())}</text><text class="deck-front" x="${width - GEO.margin}" y="${labelY}" text-anchor="end">${front}</text></g>`);

    // Wheels (under the body)
    for (const a of geo.axles) {
      const len = 40;
      for (const side of [-1, 1]) {
        const across = side < 0 ? -6 : geo.W - 6;
        g.push(rect(T({ along: a - len / 2, across, len, wid: 12 }), 'bus-wheel', 5));
      }
    }
    // Mirrors
    if (deck.key === 'L') {
      for (const side of [-1, 1]) {
        const across = side < 0 ? -9 : geo.W - 1;
        g.push(rect(T({ along: 14, across, len: 9, wid: 10 }), 'bus-mirror', 3));
      }
    }
    // Body (+ a soft offset shadow drawn as a shape — cheaper than a CSS filter)
    g.push(`<path class="bus-shadow" d="${bodyPath}" transform="translate(0 7)"/>`);
    g.push(`<path class="bus-body" d="${bodyPath}"/>`);
    const inner = T({ along: 6, across: GEO.wall - 4, len: geo.L - 12, wid: geo.W - (GEO.wall - 4) * 2 });
    g.push(`<path class="bus-floor" d="${flipped ? rrPath(inner.x, inner.y, inner.w, inner.h, 9, 28, 28, 9) : rrPath(inner.x, inner.y, inner.w, inner.h, 28, 9, 9, 28)}"/>`);
    // Windscreen + lights
    g.push(rect(T(deck.parts.windscreen), 'bus-glass', 6));
    const ws = T({ along: 6, across: geo.W * 0.62, len: 3, wid: geo.W * 0.22 });
    g.push(rect(ws, 'bus-glint', 1.5));
    for (const across of [3, geo.W - 13]) g.push(rect(T({ along: 1, across, len: 5, wid: 10 }), 'bus-headlight', 2));
    for (const across of [4, geo.W - 16]) g.push(rect(T({ along: geo.L - 5, across, len: 4, wid: 12 }), 'bus-taillight', 1.5));
    // Rear engine grille
    for (let i = 0; i < 3; i++) g.push(rect(T({ along: geo.L - 22 + i * 5, across: geo.W * 0.3, len: 2, wid: geo.W * 0.4 }), 'bus-grille', 1));
    // Side windows strip (subtle)
    // Aisle
    g.push(rect(T(deck.parts.aisle), 'bus-aisle', 6));
    if (deck.parts.openArea) {
      const oa = T(deck.parts.openArea);
      g.push(rect(oa, 'bus-open', 10));
      g.push(`<text class="bus-note" x="${r1(oa.x + oa.w / 2)}" y="${r1(oa.y + oa.h / 2 + 4)}" text-anchor="middle">${deck.key === 'L' ? 'Luggage / open area' : 'Open area'}</text>`);
    }
    // Dashboard, driver, steering wheel, door
    if (deck.parts.dashboard) g.push(rect(T(deck.parts.dashboard), 'bus-dash', 3));
    if (deck.parts.driver) {
      const d = T(deck.parts.driver);
      g.push(`<g class="bus-driver">${rect(d, 'driver-seat', 9)}${rect(flipped ? { x: d.x + 3, y: d.y + 3, w: 9, h: d.h - 6 } : { x: d.x + d.w - 12, y: d.y + 3, w: 9, h: d.h - 6 }, 'driver-back', 4)}<text class="driver-label" x="${r1(d.x + d.w / 2)}" y="${r1(d.y + d.h / 2 + 3.5)}" text-anchor="middle">Driver</text></g>`);
      const wc = P(deck.parts.wheel.cx, deck.parts.wheel.cy);
      const wr = deck.parts.wheel.r;
      g.push(`<g class="bus-steering"><circle cx="${r1(wc.x)}" cy="${r1(wc.y)}" r="${wr}"/><circle class="hub" cx="${r1(wc.x)}" cy="${r1(wc.y)}" r="3.5"/><path d="M${r1(wc.x - wr)},${r1(wc.y)}H${r1(wc.x + wr)}M${r1(wc.x)},${r1(wc.y)}V${r1(wc.y + (flipped ? -wr : wr))}"/></g>`);
    }
    if (deck.parts.door) {
      const dr = T(deck.parts.door);
      g.push(rect(dr, 'bus-door', 2));
      const steps = 3;
      for (let i = 1; i < steps; i++) {
        const sx = dr.x + (dr.w / steps) * i;
        g.push(`<line class="bus-door-line" x1="${r1(sx)}" y1="${r1(dr.y + 2)}" x2="${r1(sx)}" y2="${r1(dr.y + dr.h - 2)}"/>`);
      }
      // Entry arrow + label inside the bus next to the door
      const inside = T({ along: deck.parts.door.along + 8, across: geo.doorSide === 'left' ? GEO.wall + 2 : geo.W - GEO.wall - 16, len: deck.parts.door.len - 16, wid: 14 });
      g.push(`<text class="bus-note door-label" x="${r1(inside.x + inside.w / 2)}" y="${r1(inside.y + inside.h / 2 + 4)}" text-anchor="middle">Door</text>`);
    }
    if (deck.parts.stairs) {
      const s = T(deck.parts.stairs);
      g.push(rect(s, 'bus-stairs', 8));
      const n = 5;
      for (let i = 1; i < n; i++) {
        const sx = s.x + (s.w / n) * i;
        g.push(`<line class="bus-step" x1="${r1(sx)}" y1="${r1(s.y + 4)}" x2="${r1(sx)}" y2="${r1(s.y + s.h - 4)}"/>`);
      }
      g.push(`<text class="bus-note stairs-label" x="${r1(s.x + s.w / 2)}" y="${r1(s.y + s.h / 2 + 4)}" text-anchor="middle">${deck.key === 'L' ? 'Stairs ↑' : 'Stairs ↓'}</text>`);
    }

    // Seats
    for (const seat of deck.seats) {
      const r = T(seat);
      const st = seatState(seat) || { state: 'available' };
      const cls = ['seat', `seat--${st.state}`];
      if (st.absent) cls.push('seat--absent');
      if (st.present) cls.push('seat--present');
      if (st.selected) cls.push('seat--selected');
      if (st.highlight) cls.push('seat--highlight');
      if (st.dim) cls.push('seat--dim');
      const back = flipped ? { x: 2.5, y: 3, w: 8, h: r.h - 6 } : { x: r.w - 10.5, y: 3, w: 8, h: r.h - 6 };
      const cx = r.w / 2 + (flipped ? 4 : -4);
      const hasName = Boolean(st.name);
      const label = `<text class="seat-label" x="${r1(cx)}" y="${hasName ? 14 : r1(r.h / 2 + 4)}" text-anchor="middle">${esc(seat.label)}</text>`;
      // Squeeze long names into the seat instead of letting them overflow.
      const maxW = r.w - 14;
      const fit = hasName && st.name.length * 5.7 > maxW ? ` textLength="${r1(maxW)}" lengthAdjust="spacingAndGlyphs"` : '';
      const name = hasName ? `<text class="seat-name" x="${r1(cx)}" y="${r1(r.h / 2 + 8)}" text-anchor="middle"${fit}>${esc(st.name)}</text>` : '';
      let deco = '';
      if (st.state === 'unavailable') {
        deco = `<path class="seat-cross" d="M8,8L${r1(r.w - 8)},${r1(r.h - 8)}M${r1(r.w - 8)},8L8,${r1(r.h - 8)}"/>`;
      } else if (st.state === 'reserved') {
        deco = `<rect class="seat-hatch" x="0" y="0" width="${r1(r.w)}" height="${r1(r.h)}" rx="8"/>`;
      } else if (st.state === 'vip') {
        const cx2 = flipped ? r.w - 9 : 9;
        deco = `<path class="seat-crown" transform="translate(${r1(cx2 - 6)},${r1(r.h - 14)}) scale(0.5)" d="M2,8 7,12 12,4 17,12 22,8 20,20 4,20Z"/>`;
      }
      const tag = st.tag ? `<text class="seat-tag-text" x="${r1(cx)}" y="${r1(r.h - 4.5)}" text-anchor="middle">${esc(st.tag)}</text>` : '';
      const dot = st.state === 'assigned' || st.assigned ? `<circle class="seat-dot ${st.present ? 'is-present' : st.absent ? 'is-absent' : ''}" cx="${r1(flipped ? r.w - 7 : 7)}" cy="7" r="3.2"/>` : '';
      const aria = esc(`Seat ${seat.label}${st.aria ? `, ${st.aria}` : ''}`);
      const a11y = interactive ? ` role="button" tabindex="0" aria-label="${aria}"` : '';
      g.push(
        `<g class="${cls.join(' ')}" data-seat-id="${esc(seat.id)}" data-seat-label="${esc(seat.label)}" data-state="${st.state}" transform="translate(${r1(r.x)},${r1(r.y)})"${a11y}>` +
          `<rect class="seat-hit" x="-2" y="-2" width="${r1(r.w + 4)}" height="${r1(r.h + 4)}" rx="10"/>` +
          `<rect class="seat-base" x="0" y="0" width="${r1(r.w)}" height="${r1(r.h)}" rx="8"/>` +
          deco +
          `<rect class="seat-back" x="${r1(back.x)}" y="${r1(back.y)}" width="${back.w}" height="${r1(back.h)}" rx="3.5"/>` +
          dot +
          label +
          name +
          tag +
          `</g>`,
      );
    }
    parts.push(`<g class="deck deck--${deck.key}" data-deck="${deck.key}">${g.join('')}</g>`);
  });

  return `<svg class="bus-svg ${flipped ? 'is-flipped' : ''}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" data-bus-id="${esc(bus.id)}" data-flipped="${flipped}" data-decks="${geo.decks.length}" role="group" aria-label="${esc(`Bus ${bus.name} seat map`)}">${parts.join('')}</svg>`;
}

/** Default per-seat state computed from the store. */
export function seatStateFromStore(store, seat, { selectedSeatId, highlightPid, compact = false } = {}) {
  const typeInfo = store.seatTypes.get(seat.id);
  const type = typeInfo?.type || 'available';
  const pid = store.assignments.get(seat.id);
  const st = { state: type, label: typeInfo?.label || '' };
  if (pid) {
    const p = store.byId.get(pid);
    const att = store.attendance.get(pid);
    st.assigned = true;
    if (type === 'available') st.state = 'assigned';
    st.name = shortName(p?.name, compact ? 7 : 8);
    st.present = att?.status === 'present';
    st.absent = att?.status === 'absent';
    st.aria = `${p?.name || ''}${st.absent ? ', absent' : st.present ? ', present' : ''}`;
    if (type === 'vip' || type === 'reserved') st.tag = type === 'vip' ? 'VIP' : 'RSVD';
    if (highlightPid && pid === highlightPid) st.highlight = true;
  } else if (type === 'reserved' || type === 'vip') {
    const label = String(typeInfo.label || '').trim();
    st.name = (label.length > 11 ? `${label.slice(0, 10)}…` : label) || (type === 'vip' ? 'VIP' : 'Reserved');
    st.tag = typeInfo.label ? (type === 'vip' ? 'VIP' : 'RSVD') : '';
    st.aria = `${type === 'vip' ? 'VIP' : 'reserved'}${typeInfo.label ? ` for ${typeInfo.label}` : ''}`;
  } else if (type === 'unavailable') {
    st.aria = 'unavailable';
  } else {
    st.aria = 'available';
  }
  if (selectedSeatId === seat.id) st.selected = true;
  return st;
}

/** Decorative bus for the empty state (uses the real renderer). */
export function heroBusSVG() {
  const bus = { id: 'hero', name: 'Demo', flipped: false, config: { deckType: 'single', decks: { L: { layout: '2-2', rows: 9, backBench: true } } } };
  const names = ['Aiman', 'Siti', 'Wei Jie', 'Priya', 'Hakim', 'Aisyah', 'Ravi', 'Mei', 'Danial', 'Zara', 'Kiran', 'Hana', 'Jun', 'Alya', 'Irfan', 'Divya', 'Kai', 'Sofea', 'Arjun', 'Iman', 'Ming', 'Deepa', 'Amir', 'Balqis'];
  let i = 0;
  return renderBusSVG(
    bus,
    (seat) => {
      const n = seat.index;
      if (n === 2) return { state: 'vip', name: 'Dr. Lim', tag: 'VIP' };
      if (n === 13) return { state: 'unavailable' };
      if (n === 22) return { state: 'reserved', name: 'Guide', tag: 'RSVD' };
      if (n % 5 === 4 || n > 33) return { state: 'available' };
      const name = names[i++ % names.length];
      return { state: 'assigned', assigned: true, name, present: n % 7 !== 3, absent: n % 7 === 3, selected: n === 17 };
    },
    { interactive: false },
  );
}
