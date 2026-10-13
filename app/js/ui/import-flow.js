// Import wizard: pick a file → preview + column mapping + warnings → import.

import { h, esc } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, toast, confirmDialog } from './dialogs.js';
import { readTabularFile, toTable, DELIM_NAMES } from '../io/parse.js';
import { guessMapping, analyse } from '../io/importer.js';

const ACCEPT = '.xlsx,.xls,.csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

export function openImport(ctx, { file } = {}) {
  const { store } = ctx;
  const body = h('div', { class: 'import-flow' });
  const ov = openOverlay({ title: 'Import participant list', subtitle: 'Excel (.xlsx), CSV or tab-delimited text', content: body, size: 'lg', icon: 'upload' });

  const st = { parsed: null, sheet: 0, hasHeader: true, table: null, mapping: null, mode: store.participants.length ? 'new' : 'new', fileName: '' };

  function stepPick(error = '') {
    const input = h('input', { type: 'file', accept: ACCEPT, class: 'sr-only', 'data-testid': 'file-input' });
    const zone = h('label', { class: 'dropzone', 'data-testid': 'dropzone' });
    zone.innerHTML = `
      <span class="big-icon">${icon('upload')}</span>
      <strong>Choose a file</strong>
      <small>Tap to browse Files, iCloud Drive or OneDrive · or drop a file here</small>
      <span class="formats"><span class="badge">.xlsx</span><span class="badge">.csv</span><span class="badge">.txt (tab / ; / ,)</span></span>`;
    zone.append(input);
    input.addEventListener('change', () => input.files[0] && load(input.files[0]));
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const f = e.dataTransfer?.files?.[0];
      if (f) load(f);
    });
    body.replaceChildren(
      h('div', { class: 'stack' },
        error ? h('div', { class: 'notice notice--err', html: `${icon('alert')}<div>${esc(error)}</div>` }) : null,
        zone,
        h('div', { class: 'notice notice--info', html: `${icon('shield')}<div>The file is read on this iPad only. It is never uploaded anywhere.</div>` }),
      ),
    );
  }

  async function load(f) {
    body.innerHTML = `<div class="list-empty">${icon('refresh', 'spin')}<div>Reading ${esc(f.name)}…</div></div>`;
    try {
      st.parsed = await readTabularFile(f);
      st.fileName = f.name;
      // Pick the first sheet that has data.
      st.sheet = Math.max(0, st.parsed.sheets.findIndex((s) => s.rows.some((r) => r.some((c) => String(c).trim()))));
      buildTable(true);
      stepMap();
    } catch (err) {
      console.error(err);
      stepPick(`Could not read “${f.name}”: ${err.message || err}`);
    }
  }

  function buildTable(resetMapping) {
    st.table = toTable(st.parsed.sheets[st.sheet].rows, { hasHeader: st.hasHeader });
    if (resetMapping || !st.mapping) st.mapping = guessMapping(st.table.headers, st.table.records);
  }

  function stepMap() {
    const { table, mapping, parsed } = st;
    if (!table.headers.length || !table.records.length) {
      stepPick('That sheet looks empty. Choose another file.');
      return;
    }
    const a = analyse(table, mapping);
    const opt = (sel) => table.headers.map((hd) => `<option value="${esc(hd)}" ${hd === sel ? 'selected' : ''}>${esc(hd)}</option>`).join('');
    const reused = Object.entries(mapping.reused).filter(([, v]) => v);
    const reusedNames = { present: 'Present', seat: 'Seat', remarks: 'Remarks', bus: 'Bus', time: 'Check-in time' };
    const usedCols = new Set([mapping.name, mapping.id, ...reused.map(([, v]) => v)]);
    const infoCandidates = table.headers.filter((hd) => !usedCols.has(hd));

    const warnings = [];
    if (a.duplicates.length) {
      warnings.push(`<strong>${a.duplicates.length} duplicate ID${a.duplicates.length > 1 ? 's' : ''}</strong>: ${a.duplicates.slice(0, 5).map((d) => `${esc(d.id)} (rows ${d.lines.join(', ')})`).join('; ')}${a.duplicates.length > 5 ? '…' : ''}`);
    }
    if (a.emptyRows) warnings.push(`<strong>${a.emptyRows} empty row${a.emptyRows > 1 ? 's' : ''}</strong> will be skipped.`);
    if (a.missingName.length) warnings.push(`<strong>${a.missingName.length} row(s) without a name</strong> (rows ${a.missingName.slice(0, 8).join(', ')}${a.missingName.length > 8 ? '…' : ''}).`);
    if (a.missingId.length) warnings.push(`<strong>${a.missingId.length} row(s) without an ID</strong> (rows ${a.missingId.slice(0, 8).join(', ')}${a.missingId.length > 8 ? '…' : ''}).`);
    if (mapping.name && mapping.name === mapping.id) warnings.push('<strong>Name and ID use the same column.</strong> Pick two different columns.');

    const cls = (hd) => (hd === mapping.name ? 'col-name' : hd === mapping.id ? 'col-id' : usedCols.has(hd) ? 'col-reused' : '');
    const tag = (hd) => (hd === mapping.name ? '<span class="tag">NAME</span>' : hd === mapping.id ? '<span class="tag">ID</span>' : usedCols.has(hd) ? '<span class="tag">REUSED</span>' : '');
    const preview = table.records.slice(0, 8);
    const sheetSel =
      parsed.sheets.length > 1
        ? `<label class="field"><span class="field-label">Sheet</span><select class="select" data-k="sheet">${parsed.sheets.map((s, i) => `<option value="${i}" ${i === st.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>`
        : '';
    const hasExisting = store.participants.length > 0;

    body.innerHTML = `
      <div class="stack">
        <div class="row-wrap">
          <span class="badge badge--brand">${icon('file')}${esc(st.fileName)}</span>
          <span class="badge">${parsed.kind.toUpperCase()}${parsed.delimiter ? ` · ${DELIM_NAMES[parsed.delimiter]}-separated` : ''}</span>
          <span class="badge badge--green" data-testid="import-count">${a.count} participants</span>
          <span class="spacer"></span>
          <label class="check"><input type="checkbox" data-k="header" ${st.hasHeader ? 'checked' : ''}><span>First row is the header</span></label>
        </div>
        <div class="map-grid">
          ${sheetSel}
          <label class="field"><span class="field-label">Name column *</span><select class="select" data-k="name" data-testid="map-name">${opt(mapping.name)}</select></label>
          <label class="field"><span class="field-label">ID / matric no. column *</span><select class="select" data-k="id" data-testid="map-id">${opt(mapping.id)}</select></label>
          <label class="field"><span class="field-label">Phone column (optional)</span><select class="select" data-k="phone" data-testid="map-phone"><option value="" ${mapping.phone ? '' : 'selected'}>— None —</option>${opt(mapping.phone)}</select></label>
        </div>
        <div class="field">
          <span class="field-label">Key info shown on each row (optional)</span>
          <div class="toggle-chips" data-k="keyInfo">
            ${infoCandidates.map((hd) => `<button type="button" class="chip chip--soft" data-col="${esc(hd)}" aria-pressed="${mapping.keyInfo.includes(hd)}">${esc(hd)}</button>`).join('') || '<span class="subtle">No other columns</span>'}
          </div>
          <span class="field-hint">All other columns are kept and included in exports.</span>
        </div>
        ${reused.length ? `<div class="notice notice--ok" data-testid="reused-notice">${icon('check')}<div>Existing columns found and reused: ${reused.map(([k, v]) => `<strong>${esc(v)}</strong> → ${reusedNames[k]}`).join(', ')}.</div></div>` : ''}
        ${warnings.length ? `<div class="notice notice--warn" data-testid="import-warnings">${icon('alert')}<div>Please check:<ul>${warnings.map((w) => `<li>${w}</li>`).join('')}</ul></div></div>` : ''}
        <div class="table-wrap">
          <table class="table"><thead><tr>${table.headers.map((hd) => `<th class="${cls(hd)}">${esc(hd)}${tag(hd)}</th>`).join('')}</tr></thead>
          <tbody>${preview.map((r) => `<tr>${r.cells.map((c, i) => `<td class="${cls(table.headers[i])}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </div>
        ${table.records.length > preview.length ? `<p class="subtle mt-0">Showing ${preview.length} of ${table.records.length} rows.</p>` : ''}
        ${hasExisting ? `
        <div class="field">
          <span class="field-label">Where should this list go?</span>
          <div class="segmented" data-k="mode">
            <button type="button" data-mode="new" aria-pressed="${st.mode === 'new'}">${icon('plus')}New event</button>
            <button type="button" data-mode="replace" aria-pressed="${st.mode === 'replace'}">${icon('refresh')}Replace list in “${esc(store.event.name)}”</button>
          </div>
          <span class="field-hint">${st.mode === 'replace' ? 'Keeps event details, buses and seat types. Clears current attendance and seats.' : 'The current event stays on this device; switch between events in the Event tab.'}</span>
        </div>` : ''}
        <div class="ov-actions">
          <button type="button" class="btn btn-secondary" data-act="back">${icon('upload')}<span>Choose another file</span></button>
          <button type="button" class="btn btn-primary" data-act="import" data-testid="confirm-import" ${!mapping.name || !mapping.id || mapping.name === mapping.id ? 'disabled' : ''}>${icon('check')}<span>Import ${a.count} participants</span></button>
        </div>
      </div>`;

    body.querySelector('[data-k=header]').addEventListener('change', (e) => {
      st.hasHeader = e.target.checked;
      buildTable(true);
      stepMap();
    });
    body.querySelector('[data-k=sheet]')?.addEventListener('change', (e) => {
      st.sheet = Number(e.target.value);
      buildTable(true);
      stepMap();
    });
    for (const k of ['name', 'id', 'phone']) {
      body.querySelector(`[data-k=${k}]`).addEventListener('change', (e) => {
        st.mapping[k] = e.target.value;
        st.mapping.keyInfo = st.mapping.keyInfo.filter((c) => c !== e.target.value);
        stepMap();
      });
    }
    body.querySelector('[data-k=keyInfo]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-col]');
      if (!b) return;
      const col = b.dataset.col;
      const set = st.mapping.keyInfo;
      if (set.includes(col)) st.mapping.keyInfo = set.filter((c) => c !== col);
      else st.mapping.keyInfo = [...set, col].slice(-3);
      stepMap();
    });
    body.querySelector('[data-k=mode]')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      st.mode = b.dataset.mode;
      stepMap();
    });
    body.querySelector('[data-act=back]').addEventListener('click', () => stepPick());
    body.querySelector('[data-act=import]').addEventListener('click', () => doImport(a));
  }

  async function doImport(a) {
    if (a.duplicates.length) {
      const ok = await confirmDialog({
        title: 'Import with duplicate IDs?',
        message: `${a.duplicates.length} ID(s) appear more than once. Both rows will be imported so nobody is lost — you can tidy the list later.`,
        okLabel: 'Import anyway',
      });
      if (!ok) return;
    }
    if (st.mode === 'replace') {
      const ok = await confirmDialog({
        title: 'Replace the current list?',
        message: `Attendance and seat assignments of “${store.event.name}” will be cleared. Download a backup first if you need them.`,
        okLabel: 'Replace list',
        danger: true,
      });
      if (!ok) return;
    }
    const btn = body.querySelector('[data-act=import]');
    btn.disabled = true;
    try {
      const res = await store.importList({ table: st.table, mapping: st.mapping, mode: st.mode, fileName: st.fileName });
      ov.close(true);
      const bits = [`Imported ${res.count} participants`];
      if (res.seated) bits.push(`${res.seated} seats restored`);
      toast(bits.join(' · '), { kind: 'success' });
      if (res.unmatchedSeats.length) {
        toast(`${res.unmatchedSeats.length} seat value(s) did not match a seat on the buses and were ignored.`, { kind: 'warn', duration: 6000 });
      }
      ctx.navigate('attendance');
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      toast(`Import failed: ${err.message || err}`, { kind: 'error', duration: 6000 });
    }
  }

  if (file) load(file);
  else stepPick();
  return ov.closed;
}
