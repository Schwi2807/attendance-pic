// File parsing: .xlsx via SheetJS, .csv/.txt via a small RFC-4180 parser with
// delimiter detection (comma, tab, semicolon). Output is always a grid of
// strings so the importer does not care where the data came from.

import { getXLSX } from './vendor.js';

const DELIMS = [',', '\t', ';'];
export const DELIM_NAMES = { ',': 'Comma', '\t': 'Tab', ';': 'Semicolon' };

/** Counts delimiter occurrences outside double quotes for one line. */
function countOutsideQuotes(line, d) {
  let n = 0;
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === d && !q) n++;
  }
  return n;
}

/** Picks the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text) {
  const lines = text
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim())
    .slice(0, 30);
  if (!lines.length) return ',';
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const header = counts[0];
    if (!header) continue;
    const consistent = counts.filter((c) => c === header).length / counts.length;
    // Consistency dominates; more columns break ties (tab > comma when both fit).
    const score = consistent * 1000 + Math.min(header, 50) + (d === '\t' ? 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** RFC-4180-ish parser: quotes, escaped quotes, CRLF/LF/CR, embedded newlines. */
export function parseDelimited(text, d) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      q = true;
    } else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Decodes bytes as UTF-8 (BOM-aware), falling back to Windows-1252 for old Excel CSVs. */
export function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    }
  }
}

const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

/**
 * Reads a File/Blob into sheets of string rows.
 * @returns {Promise<{kind: string, delimiter?: string, sheets: {name: string, rows: string[][]}[]}>}
 */
export async function readTabularFile(file) {
  const ext = extOf(file.name);
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf.slice(0, 4));
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK" — xlsx container
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || isZip) {
    const XLSX = await getXLSX();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, dense: false });
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils
        .sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true, dateNF: 'yyyy-mm-dd' })
        .map((r) => r.map((v) => (v == null ? '' : String(v)))),
    }));
    return { kind: 'xlsx', sheets };
  }
  const text = decodeText(buf);
  const delimiter = detectDelimiter(text);
  return { kind: ext === 'txt' ? 'txt' : 'csv', delimiter, sheets: [{ name: file.name, rows: parseDelimited(text, delimiter) }] };
}

/**
 * Turns raw rows into { headers, records, emptyRows }.
 * - the first non-empty row is the header (unless hasHeader is false)
 * - blank/duplicate header names are made unique
 * - trailing empty columns are dropped
 */
export function toTable(rows, { hasHeader = true } = {}) {
  const trimmed = rows.map((r) => r.map((c) => String(c ?? '').trim()));
  const firstIdx = trimmed.findIndex((r) => r.some((c) => c !== ''));
  if (firstIdx < 0) return { headers: [], records: [], emptyRows: 0 };
  const width = Math.max(...trimmed.map((r) => {
    let w = r.length;
    while (w > 0 && r[w - 1] === '') w--;
    return w;
  }));
  const headerRow = hasHeader ? trimmed[firstIdx] : [];
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, i) => {
    let h = (headerRow[i] || '').replace(/\s+/g, ' ') || `Column ${i + 1}`;
    const key = h.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) h = `${h} (${n})`;
    return h;
  });
  const records = [];
  let emptyRows = 0;
  const start = hasHeader ? firstIdx + 1 : firstIdx;
  // Empty rows between data count as warnings; trailing blank rows are ignored.
  let lastData = trimmed.length - 1;
  while (lastData >= start && !trimmed[lastData].some((c) => c !== '')) lastData--;
  for (let i = start; i <= lastData; i++) {
    const cells = Array.from({ length: width }, (_, c) => trimmed[i][c] ?? '');
    if (!cells.some((c) => c !== '')) {
      emptyRows++;
      continue;
    }
    records.push({ line: i + 1, cells });
  }
  return { headers, records, emptyRows };
}
