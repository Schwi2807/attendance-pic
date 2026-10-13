// Column mapping + conversion of a parsed table into participants.
//
// The user picks the Name and ID columns. Existing "Present", "Seat",
// "Remarks" (and "Bus" / "Check-in Time", written by our own export) columns
// are recognised case-insensitively and reused, so a file exported by this app
// can be imported again without losing anything. Every other column is kept
// as extra info and written back out on export.

import { newId } from '../utils/ids.js';
import { emptyAttendance, STATUS } from '../domain/model.js';

const PATTERNS = {
  name: [/^(full\s*)?name$/i, /^nama(\s*penuh)?$/i, /^(student|participant|peserta)\s*name$/i, /name|nama/i],
  id: [
    /^(matric|matrik)(\s*(no|number|num)\.?)?$/i,
    /^no\.?\s*(matric|matrik)$/i,
    /^(student|staff)\s*(id|no\.?|number)$/i,
    /^id$/i,
    /matric|matrik|student\s*id|no\.?\s*pelajar|^ic|\bid\b/i,
  ],
  present: [/^(present|attendance|kehadiran|hadir)$/i],
  seat: [/^seat(\s*(no\.?|number))?$/i, /^(tempat\s*duduk|kerusi)$/i],
  remarks: [/^(remarks?|notes?|catatan|comments?)$/i],
  bus: [/^bus(\s*(no\.?|name|number))?$/i, /^bas$/i],
  time: [/^check[\s-]?in(\s*time)?$/i, /^(time|masa)$/i],
  phone: [
    /^(phone|tel|telephone|mobile|hp|h\/p|handphone|contact)(\s*(no\.?|number|num))?$/i,
    /^no\.?\s*(tel|telefon|hp|h\/p|phone|handphone)$/i,
    /^(nombor|no\.?)\s*telefon(\s*bimbit)?$/i,
    /phone|telefon|mobile|handphone|\btel\b|\bh\/p\b/i,
  ],
};

/** Best guess for the phone-number column ('' if none). */
export function guessPhoneColumn(headers, exclude = []) {
  return guess(headers, 'phone', exclude);
}

function guess(headers, kind, exclude = []) {
  for (const re of PATTERNS[kind]) {
    const h = headers.find((x) => re.test(x) && !exclude.includes(x));
    if (h) return h;
  }
  return '';
}

/** Best-guess mapping for a header list. */
export function guessMapping(headers, records = []) {
  const reused = {
    present: guess(headers, 'present'),
    seat: guess(headers, 'seat'),
    remarks: guess(headers, 'remarks'),
    bus: guess(headers, 'bus'),
    time: guess(headers, 'time'),
  };
  const taken = Object.values(reused).filter(Boolean);
  const name = guess(headers, 'name', taken) || headers.find((h) => !taken.includes(h)) || '';
  let id = guess(headers, 'id', [...taken, name]);
  if (!id) {
    // Fall back to the first column whose values look like IDs (letters+digits, mostly unique).
    id =
      headers.find((h, i) => {
        if (h === name || taken.includes(h)) return false;
        const vals = records.slice(0, 50).map((r) => r.cells[i]).filter(Boolean);
        return vals.length && vals.filter((v) => /^[A-Za-z]{0,4}\d{4,}[A-Za-z0-9]*$/.test(v)).length / vals.length > 0.8;
      }) || '';
  }
  const phone = guess(headers, 'phone', [...taken, name, id]);
  const skip = new Set([name, id, phone, ...taken, ...headers.filter((h) => /^(no\.?|bil\.?|#|num)$/i.test(h))]);
  const keyInfo = headers.filter((h) => h && !skip.has(h)).slice(0, 2);
  return { name, id, phone, keyInfo, reused };
}

const PRESENT_RE = /^(present|p|yes|y|1|true|hadir|✓|✔|☑)$/i;
const ABSENT_RE = /^(absent|a|no|n|0|false|tidak\s*hadir|tak\s*hadir|ponteng|✗|✘|×)$/i;

export function parsePresentValue(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (PRESENT_RE.test(s)) return STATUS.PRESENT;
  if (ABSENT_RE.test(s)) return STATUS.ABSENT;
  return null;
}

function parseTime(v) {
  const m = /(\d{1,2})[:.](\d{2})/.exec(String(v ?? ''));
  if (!m) return '';
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${m[2]}` : '';
}

/**
 * Checks a table + mapping and returns warnings without changing anything.
 */
export function analyse(table, mapping) {
  const ni = table.headers.indexOf(mapping.name);
  const ii = table.headers.indexOf(mapping.id);
  const byId = new Map();
  const missingName = [];
  const missingId = [];
  for (const r of table.records) {
    const name = ni >= 0 ? r.cells[ni] : '';
    const id = ii >= 0 ? r.cells[ii] : '';
    if (!name) missingName.push(r.line);
    if (!id) missingId.push(r.line);
    if (id) {
      const k = id.toUpperCase();
      if (!byId.has(k)) byId.set(k, []);
      byId.get(k).push(r.line);
    }
  }
  const duplicates = [...byId.entries()].filter(([, lines]) => lines.length > 1).map(([id, lines]) => ({ id, lines }));
  return { count: table.records.length, emptyRows: table.emptyRows, duplicates, missingName, missingId };
}

/**
 * Builds participants + initial attendance + seat requests.
 * @returns {{ participants, attendance, seatRequests, columns }}
 */
export function buildParticipants(table, mapping, eventId, sessionId) {
  const idx = (h) => (h ? table.headers.indexOf(h) : -1);
  const ni = idx(mapping.name);
  const ii = idx(mapping.id);
  const r = mapping.reused || {};
  const pi = idx(r.present);
  const si = idx(r.seat);
  const ri = idx(r.remarks);
  const bi = idx(r.bus);
  const ti = idx(r.time);
  const reusedSet = new Set([r.present, r.seat, r.remarks, r.bus, r.time].filter(Boolean));

  const participants = [];
  const attendance = [];
  const seatRequests = [];
  table.records.forEach((rec, order) => {
    const pid = newId('p');
    const original = {};
    const extra = {};
    table.headers.forEach((h, c) => {
      original[h] = rec.cells[c] ?? '';
      if (c !== ni && c !== ii && !reusedSet.has(h)) extra[h] = rec.cells[c] ?? '';
    });
    participants.push({
      id: pid,
      eventId,
      order,
      line: rec.line,
      name: ni >= 0 ? rec.cells[ni] : '',
      studentId: ii >= 0 ? rec.cells[ii] : '',
      original,
      extra,
    });
    const a = emptyAttendance(sessionId, pid);
    if (pi >= 0) a.status = parsePresentValue(rec.cells[pi]);
    if (ri >= 0) a.remarks = rec.cells[ri] || '';
    if (a.status && ti >= 0) a.time = parseTime(rec.cells[ti]);
    attendance.push(a);
    if (si >= 0 && rec.cells[si]) seatRequests.push({ participantId: pid, seat: rec.cells[si], bus: bi >= 0 ? rec.cells[bi] : '' });
  });

  const columns = {
    headers: [...table.headers],
    name: mapping.name,
    id: mapping.id,
    phone: mapping.phone || '',
    keyInfo: [...(mapping.keyInfo || [])],
    reused: { present: r.present || '', seat: r.seat || '', remarks: r.remarks || '', bus: r.bus || '', time: r.time || '' },
  };
  return { participants, attendance, seatRequests, columns };
}
