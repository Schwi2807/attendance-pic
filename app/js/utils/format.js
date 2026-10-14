// Small formatting helpers (dates, times, file names, search normalisation).

export const pad2 = (n) => String(n).padStart(2, '0');

/** "HH:MM" in the device's local time. */
export function hhmm(date = new Date()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "13 Oct 2026" — unambiguous in any locale (no 13/10 vs 10/13 confusion). */
export function dayText(date) {
  return `${pad2(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * Attendance time stamp as "{date}, {HH:mm}", e.g. "13 Oct 2026, 08:15".
 * Records stamped by the app carry the full moment in `at`; times imported
 * from a file without a date fall back to the event date.
 */
export function stampText(record, fallbackYmd = '') {
  if (!record?.time) return '';
  let d = record.at ? new Date(record.at) : null;
  if ((!d || Number.isNaN(d.getTime())) && /^\d{4}-\d{2}-\d{2}$/.test(fallbackYmd)) {
    const [y, m, dd] = fallbackYmd.split('-').map(Number);
    d = new Date(y, m - 1, dd);
  }
  return d && !Number.isNaN(d.getTime()) ? `${dayText(d)}, ${record.time}` : record.time;
}

/**
 * Reads a time stamp written by us or typed in a spreadsheet:
 * "13 Oct 2026, 08:15", "13/10/2026 08:15", "13.10.2026 08.15", "2026-10-13T08:15", "08:15".
 * @returns {{ time: string, at: string|null }}
 */
export function parseStamp(value) {
  const s = String(value ?? '').trim();
  // Blank out numeric dates first so "13.10.2026 08:15" is not read as 13:10.
  const t = /(\d{1,2})[:.](\d{2})(?!\d)/.exec(s.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/g, ' '));
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return { time: '', at: null };
  const time = `${pad2(t[1])}:${t[2]}`;
  let date = null;
  let m;
  if ((m = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/.exec(s))) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase() === m[2].toLowerCase());
    if (mi >= 0) date = new Date(Number(m[3]), mi, Number(m[1]));
  } else if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(s))) {
    date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else if ((m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s))) {
    date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); // day/month/year
  }
  if (date && !Number.isNaN(date.getTime())) {
    date.setHours(Number(t[1]), Number(t[2]), 0, 0);
    return { time, at: date.toISOString() };
  }
  return { time, at: null };
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
