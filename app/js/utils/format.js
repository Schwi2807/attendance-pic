// Small formatting helpers (dates, times, file names, search normalisation).

export const pad2 = (n) => String(n).padStart(2, '0');

/** "HH:MM" in the device's local time. */
export function hhmm(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "YYYY-MM-DD" in the device's local time. */
export function isoDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** "Tue, 13 Oct 2026" for a "YYYY-MM-DD" string (falls back to the raw value). */
export function prettyDate(ymd) {
  if (!ymd) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Characters that are safe in file names on iOS, Windows and macOS. */
export function safeFilePart(s, fallback = 'Event') {
  const cleaned = String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return cleaned || fallback;
}

/** Attendance_<EventName>_<YYYY-MM-DD>.<ext> */
export function exportFileName(eventName, date, ext) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : isoDate();
  return `Attendance_${safeFilePart(eventName)}_${day}.${ext}`;
}

/** Lower-case, accent-free, single-spaced string for searching. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function initials(name) {
  const parts = String(name || '')
    .replace(/\b(bin|binti|bt|b\.|a\/l|a\/p|al|ap)\b/gi, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || '';
  return (first + last).toUpperCase();
}

/** First "useful" word of a name, for tight spaces such as a seat. */
export function shortName(name, max = 9) {
  const parts = String(name || '').trim().split(/\s+/);
  let s = parts[0] || '';
  // Common Malay/Arabic first-name prefixes read better with the next word.
  if (/^(muhammad|mohd|mohamad|mohammad|muhd|nur|nurul|siti|wan|nik|tengku|ahmad|abdul|syed|sharifah)$/i.test(s) && parts[1]) {
    s = parts[1];
  }
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}
