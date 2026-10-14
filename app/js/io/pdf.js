// PDF export (A4): header + attendance table (auto landscape for wide lists),
// optional seat maps — one page per deck, drawn as vectors from the same
// geometry the on-screen SVG uses.

import { getJsPDF } from './vendor.js';
import { buildExportTable, eventInfoLines } from './export.js';
import { computeGeometry, toScreen, toScreenPoint, GEO } from '../domain/layout.js';
import { busStats, busSummaryText } from '../domain/capacity.js';

const C = {
  brand: [61, 90, 254],
  ink: [11, 18, 32],
  ink2: [74, 85, 104],
  ink3: [133, 146, 168],
  line: [226, 232, 240],
  absent: [253, 226, 226],
  absentStroke: [238, 143, 146],
  present: [16, 163, 82],
  absentInk: [201, 52, 58],
  taken: [223, 231, 255],
  takenStroke: [77, 104, 255],
  free: [255, 255, 255],
  freeStroke: [185, 196, 214],
  unavail: [232, 235, 241],
  unavailStroke: [201, 207, 218],
  reserved: [239, 234, 255],
  reservedStroke: [124, 92, 255],
  vip: [255, 244, 204],
  vipStroke: [201, 154, 6],
  body: [250, 251, 254],
  bodyStroke: [195, 205, 221],
  aisle: [236, 241, 248],
  glass: [200, 220, 255],
  wheel: [31, 38, 51],
  door: [255, 215, 106],
};

// jsPDF's built-in Helvetica covers Windows-1252 only.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));
export function pdfSafe(s) {
  return Array.from(String(s ?? ''))
    .map((ch) => {
      const code = ch.codePointAt(0);
      if (code < 0x100 || CP1252_EXTRA.has(ch)) return ch;
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      return base && base.codePointAt(0) < 0x100 ? base : '?';
    })
    .join('');
}

function needsLandscape(t) {
  if (t.headers.length > 8) return true;
  const sample = t.rows.slice(0, 200);
  const est = t.headers.reduce((sum, h, c) => {
    const len = Math.max(String(h).length, ...sample.map((r) => String(r.cells[c] ?? '').length));
    return sum + Math.min(len, 34) * 1.55 + 3.4;
  }, 0);
  return est > 182;
}

function drawReportHeader(doc, store, y0 = 14) {
  const W = doc.internal.pageSize.getWidth();
  const info = eventInfoLines(store);
  doc.setFillColor(...C.brand);
  doc.roundedRect(14, y0, 4, 14, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.ink3);
  doc.text('ATTENDANCE REPORT', 21, y0 + 3.2);
  doc.setFontSize(17);
  doc.setTextColor(...C.ink);
  doc.text(pdfSafe(info.title), 21, y0 + 10.5, { maxWidth: W - 35 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...C.ink2);
  doc.text(pdfSafe(info.meta.join('   ·   ') || ' '), 21, y0 + 16.5, { maxWidth: W - 35 });

  // Count pills
  const pills = [
    ['Total', info.c.total, C.ink, [241, 245, 249]],
    ['Present', info.c.present, C.present, [225, 247, 234]],
    ['Absent', info.c.absent, C.absentInk, C.absent],
    ['Unmarked', info.c.unmarked, C.ink2, [241, 245, 249]],
  ];
  let x = 14;
  const y = y0 + 21;
  for (const [label, n, ink, bg] of pills) {
    const text = `${label}  ${n}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const w = doc.getTextWidth(text) + 8;
    doc.setFillColor(...bg);
    doc.roundedRect(x, y, w, 7, 3.5, 3.5, 'F');
    doc.setTextColor(...ink);
    doc.text(text, x + 4, y + 4.8);
    x += w + 3;
  }
  return y + 11;
}

function drawFooters(doc, store) {
  const n = doc.internal.getNumberOfPages();
  const stamp = new Date().toLocaleString();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(14, H - 11, W - 14, H - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.ink3);
    doc.text(pdfSafe(`${store.event.name || 'Attendance'} · generated ${stamp} · Attendance PIC (offline)`), 14, H - 6.5);
    doc.text(`Page ${i} of ${n}`, W - 14, H - 6.5, { align: 'right' });
  }
}

function drawTable(doc, store, t) {
  const startY = drawReportHeader(doc, store);
  const W = doc.internal.pageSize.getWidth();
  const appStart = t.headers.length - 5;
  doc.autoTable({
    head: [t.headers.map(pdfSafe)],
    body: t.rows.map((r) => r.cells.map(pdfSafe)),
    startY,
    theme: 'grid',
    margin: { left: 14, right: 14, top: 20, bottom: 16 },
    styles: { font: 'helvetica', fontSize: t.headers.length > 10 ? 7 : 8, cellPadding: 1.6, overflow: 'linebreak', lineColor: C.line, lineWidth: 0.15, textColor: C.ink, valign: 'middle' },
    headStyles: { fillColor: C.brand, textColor: 255, fontStyle: 'bold', lineColor: C.brand },
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    didParseCell(data) {
      if (data.section !== 'body') return;
      const row = t.rows[data.row.index];
      if (row?.absent) data.cell.styles.fillColor = C.absent;
      if (data.column.index === appStart) {
        data.cell.styles.fontStyle = 'bold';
        if (row?.status === 'present') data.cell.styles.textColor = C.present;
        if (row?.status === 'absent') data.cell.styles.textColor = C.absentInk;
      }
    },
    didDrawPage(data) {
      if (data.pageNumber > 1) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(...C.ink2);
        doc.text(pdfSafe(store.event.name || 'Attendance'), 14, 12);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C.ink3);
        doc.text('continued', W - 14, 12, { align: 'right' });
      }
    },
  });
}

// ── Seat maps ───────────────────────────────────────────────────────────────
function hatch(doc, x, y, w, h, step = 2.2) {
  for (let k = step; k < w + h; k += step) {
    const x1 = x + Math.min(k, w);
    const y1 = y + Math.max(0, k - w);
    const x2 = x + Math.max(0, k - h);
    const y2 = y + Math.min(k, h);
    doc.line(x1, y1, x2, y2);
  }
}

function seatVisual(store, seat) {
  const typeInfo = store.seatTypes.get(seat.id);
  const type = typeInfo?.type || 'available';
  const pid = store.assignments.get(seat.id);
  const p = pid ? store.byId.get(pid) : null;
  const status = pid ? store.attendance.get(pid)?.status : null;
  return { type, label: typeInfo?.label || '', person: p, status };
}

function drawDeckPage(doc, store, bus, geo, deck) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const flipped = Boolean(bus.flipped);
  const s = busStats(bus, store.seatTypes, store.assignments);
  const info = eventInfoLines(store);

  // Title
  doc.setFillColor(...C.brand);
  doc.roundedRect(14, 12, 4, 13, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...C.ink);
  const deckName = geo.decks.length > 1 ? `${deck.name} deck` : 'Seat map';
  doc.text(pdfSafe(`Bus ${bus.name} — ${deckName}`), 21, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...C.ink2);
  doc.text(pdfSafe(busSummaryText(bus, s)), 21, 24);
  doc.setFontSize(8.5);
  doc.setTextColor(...C.ink3);
  doc.text(pdfSafe([info.title, ...info.meta].join('  ·  ')), W - 14, 18, { align: 'right', maxWidth: 140 });

  // Fit the deck into the page.
  const boxW = W - 28;
  const boxH = H - 30 - 34;
  const unitsW = geo.L + GEO.margin * 2;
  const unitsH = geo.W + GEO.margin * 2;
  const k = Math.min(boxW / unitsW, boxH / unitsH);
  const x0 = 14 + (boxW - unitsW * k) / 2;
  const y0 = 32 + (boxH - unitsH * k) / 2;
  const T = (box) => {
    const r = toScreen(box, geo, flipped, 0, -GEO.labelH);
    return { x: x0 + r.x * k, y: y0 + r.y * k, w: r.w * k, h: r.h * k };
  };
  const P = (a, c) => {
    const p = toScreenPoint(a, c, geo, flipped, 0, -GEO.labelH);
    return { x: x0 + p.x * k, y: y0 + p.y * k };
  };

  // Wheels
  doc.setFillColor(...C.wheel);
  for (const a of geo.axles) {
    for (const across of [-6, geo.W - 6]) {
      const r = T({ along: a - 20, across, len: 40, wid: 12 });
      doc.roundedRect(r.x, r.y, r.w, r.h, 1, 1, 'F');
    }
  }
  // Body
  const body = T({ along: 0, across: 0, len: geo.L, wid: geo.W });
  doc.setFillColor(...C.body);
  doc.setDrawColor(...C.bodyStroke);
  doc.setLineWidth(0.5);
  doc.roundedRect(body.x, body.y, body.w, body.h, 7, 7, 'FD');
  // Windscreen
  const ws = T(deck.parts.windscreen);
  doc.setFillColor(...C.glass);
  doc.setLineWidth(0.2);
  doc.roundedRect(ws.x, ws.y, ws.w, ws.h, 1.5, 1.5, 'F');
  // Aisle
  const ai = T(deck.parts.aisle);
  doc.setFillColor(...C.aisle);
  doc.roundedRect(ai.x, ai.y, ai.w, ai.h, 1.5, 1.5, 'F');
  // Front marker
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...C.ink3);
  doc.text(flipped ? 'FRONT >' : '< FRONT', flipped ? body.x + body.w : body.x, body.y - 2.5, { align: flipped ? 'right' : 'left' });

  const label = (text, r, size = 7) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(size);
    doc.setTextColor(...C.ink3);
    doc.text(text, r.x + r.w / 2, r.y + r.h / 2 + size * 0.13, { align: 'center' });
  };
  if (deck.parts.openArea) {
    const oa = T(deck.parts.openArea);
    doc.setDrawColor(...C.bodyStroke);
    doc.setLineDashPattern([1.5, 1.2], 0);
    doc.roundedRect(oa.x, oa.y, oa.w, oa.h, 2, 2, 'S');
    doc.setLineDashPattern([], 0);
    label('LUGGAGE / OPEN AREA', oa);
  }
  if (deck.parts.driver) {
    const d = T(deck.parts.driver);
    doc.setFillColor(238, 242, 249);
    doc.setDrawColor(...C.bodyStroke);
    doc.roundedRect(d.x, d.y, d.w, d.h, 2, 2, 'FD');
    label('DRIVER', d, 6);
    const c = P(deck.parts.wheel.cx, deck.parts.wheel.cy);
    doc.setDrawColor(...C.ink2);
    doc.setLineWidth(0.7);
    doc.circle(c.x, c.y, deck.parts.wheel.r * k, 'S');
    doc.setLineWidth(0.2);
  }
  if (deck.parts.door) {
    const dr = T(deck.parts.door);
    doc.setFillColor(...C.door);
    doc.rect(dr.x, dr.y, dr.w, dr.h, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(...C.ink3);
    const above = geo.doorSide === 'left' ? !flipped : flipped;
    doc.text('DOOR', dr.x + dr.w / 2, above ? dr.y - 1.5 : dr.y + dr.h + 3.5, { align: 'center' });
  }
  if (deck.parts.stairs) {
    const st = T(deck.parts.stairs);
    doc.setFillColor(238, 242, 249);
    doc.setDrawColor(...C.bodyStroke);
    doc.setLineDashPattern([1.2, 1], 0);
    doc.roundedRect(st.x, st.y, st.w, st.h, 1.5, 1.5, 'FD');
    doc.setLineDashPattern([], 0);
    label('STAIRS', st, 6.5);
  }

  // Seats
  for (const seat of deck.seats) {
    const r = T(seat);
    const v = seatVisual(store, seat);
    let fill = C.free;
    let stroke = C.freeStroke;
    if (v.person) {
      fill = v.status === 'absent' ? C.absent : C.taken;
      stroke = v.status === 'absent' ? C.absentStroke : C.takenStroke;
    }
    if (v.type === 'unavailable') [fill, stroke] = [C.unavail, C.unavailStroke];
    if (v.type === 'reserved') [fill, stroke] = [v.status === 'absent' ? C.absent : C.reserved, C.reservedStroke];
    if (v.type === 'vip') [fill, stroke] = [v.status === 'absent' ? C.absent : C.vip, C.vipStroke];
    doc.setFillColor(...fill);
    doc.setDrawColor(...stroke);
    doc.setLineWidth(v.type === 'vip' ? 0.6 : 0.3);
    doc.roundedRect(r.x, r.y, r.w, r.h, 1.6, 1.6, 'FD');
    // backrest on the rear side (a lighter tint of the outline colour)
    const bw = 2.2;
    doc.setFillColor(...stroke.map((v) => Math.round(v + (255 - v) * 0.45)));
    doc.roundedRect(flipped ? r.x + 0.8 : r.x + r.w - bw - 0.8, r.y + 1, bw, r.h - 2, 0.8, 0.8, 'F');
    if (v.type === 'reserved' && !v.person) {
      doc.setDrawColor(198, 184, 255);
      doc.setLineWidth(0.25);
      hatch(doc, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }
    if (v.type === 'unavailable') {
      doc.setDrawColor(...C.ink3);
      doc.setLineWidth(0.35);
      doc.line(r.x + 2, r.y + 2, r.x + r.w - 2, r.y + r.h - 2);
      doc.line(r.x + r.w - 2, r.y + 2, r.x + 2, r.y + r.h - 2);
    }
    const cx = r.x + r.w / 2 + (flipped ? 1 : -1);
    const inner = r.w - 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...(v.type === 'vip' ? C.vipStroke : v.type === 'reserved' ? C.reservedStroke : v.person ? C.takenStroke : C.ink3));
    if (v.status === 'absent') doc.setTextColor(...C.absentInk);
    doc.text(pdfSafe(seat.label), cx, r.y + 3.4, { align: 'center' });
    let text = '';
    if (v.person) text = v.person.name;
    else if (v.type === 'vip' || v.type === 'reserved') text = v.label;
    if (text) {
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...C.ink);
      // Shrink the font until the longest word fits, so names are not split mid-word.
      const safe = pdfSafe(text);
      const longest = safe.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
      let size = r.w > 14 ? 6 : 5.2;
      doc.setFontSize(size);
      while (size > 4.4 && doc.getTextWidth(longest) > inner) doc.setFontSize((size -= 0.2));
      let lines = doc.splitTextToSize(safe, inner);
      if (lines.length > 2) lines = [lines[0], `${lines[1].replace(/.{0,1}$/, '')}…`];
      doc.text(lines, cx, r.y + r.h / 2 + (lines.length > 1 ? 0 : 1.2), { align: 'center' });
    }
    if (v.type === 'vip' || v.type === 'reserved') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5);
      doc.setTextColor(...(v.type === 'vip' ? C.vipStroke : C.reservedStroke));
      doc.text(v.type === 'vip' ? 'VIP' : 'RESERVED', cx, r.y + r.h - 1.4, { align: 'center' });
    } else if (v.status === 'absent') {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(5);
      doc.setTextColor(...C.absentInk);
      doc.text('ABSENT', cx, r.y + r.h - 1.4, { align: 'center' });
    }
  }

  // Legend
  const items = [
    ['Available', C.free, C.freeStroke],
    ['Assigned', C.taken, C.takenStroke],
    ['Absent', C.absent, C.absentStroke],
    ['Unavailable', C.unavail, C.unavailStroke],
    ['Reserved', C.reserved, C.reservedStroke],
    ['VIP', C.vip, C.vipStroke],
  ];
  let lx = 14;
  const ly = H - 19;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  for (const [name, f, st] of items) {
    doc.setFillColor(...f);
    doc.setDrawColor(...st);
    doc.setLineWidth(0.4);
    doc.roundedRect(lx, ly - 3, 6, 4, 0.8, 0.8, 'FD');
    doc.setTextColor(...C.ink2);
    doc.text(name, lx + 8, ly);
    lx += 10 + doc.getTextWidth(name) + 6;
  }
}

/**
 * @param {object} store
 * @param {{table?: boolean, seatMaps?: boolean}} opts
 * @returns {Promise<Blob>}
 */
export async function toPDF(store, { table = true, seatMaps = false } = {}) {
  const jsPDF = await getJsPDF();
  const t = buildExportTable(store);
  const withTable = table || !seatMaps;
  const doc = new jsPDF({ orientation: withTable ? (needsLandscape(t) ? 'landscape' : 'portrait') : 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: pdfSafe(`Attendance – ${store.event.name || ''}`), subject: 'Attendance report', creator: 'Attendance PIC', author: pdfSafe(store.event.picName || '') });
  let fresh = true;
  if (withTable) {
    drawTable(doc, store, t);
    fresh = false;
  }
  if (seatMaps) {
    for (const bus of [...store.buses].sort((a, b) => a.order - b.order)) {
      const geo = computeGeometry(bus.id, bus.config);
      for (const deck of geo.decks) {
        if (!fresh) doc.addPage('a4', 'landscape');
        fresh = false;
        drawDeckPage(doc, store, bus, geo, deck);
      }
    }
  }
  drawFooters(doc, store);
  return doc.output('blob');
}
