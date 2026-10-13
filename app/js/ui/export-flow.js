// Export dialog: pick a format (Excel, PDF, CSV, JSON backup) → handle
// unmarked rows → generate on-device → Share sheet or Download.

import { h, esc } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, toast, choiceDialog } from './dialogs.js';
import { buildExportTable, toCSV, toXLSX, toBackup } from '../io/export.js';
import { toPDF } from '../io/pdf.js';
import { makeFile, canShareFile, shareFile, downloadFile, formatBytes } from '../io/share.js';
import { exportFileName, plural } from '../utils/format.js';

const FORMATS = [
  { id: 'xlsx', label: 'Excel', ext: 'xlsx', icon: 'sheet', desc: 'Original columns + Present, Bus, Seat, Remarks, Check-in Time. Absent rows shaded.' },
  { id: 'pdf', label: 'PDF report', ext: 'pdf', icon: 'pdf', desc: 'A4 with event header, counts and page numbers. Optional seat maps.' },
  { id: 'csv', label: 'CSV', ext: 'csv', icon: 'fileText', desc: 'Same table as Excel, plain text (UTF-8).' },
  { id: 'json', label: 'Backup', ext: 'json', icon: 'database', desc: 'Full event (list, attendance, buses, seats) to restore later.' },
];

export async function openExport(ctx, preset = {}) {
  const { store } = ctx;
  if (!store.event || !store.participants.length) {
    toast('Import a participant list first.', { kind: 'warn' });
    return;
  }
  const st = { fmt: preset.fmt || 'xlsx', table: true, seatMaps: false };
  const body = h('div', { class: 'stack export-flow', 'data-testid': 'export-dialog' });
  const ov = openOverlay({ title: 'Export', subtitle: 'Files are created on this iPad — nothing is uploaded.', content: body, size: 'md', icon: 'share' });

  function renderPick() {
    const c = store.counts();
    const fmt = FORMATS.find((f) => f.id === st.fmt);
    const name = exportFileName(store.event.name, store.event.date, fmt.ext);
    body.innerHTML = `
      <div class="format-grid" role="radiogroup" aria-label="Format">
        ${FORMATS.map((f) => `<button type="button" class="format-card" role="radio" aria-checked="${f.id === st.fmt}" data-fmt="${f.id}" data-testid="fmt-${f.id}">
          <span class="format-icon fi-${f.id}">${icon(f.icon)}</span><span class="format-text"><strong>${f.label}</strong><small>${esc(f.desc)}</small></span></button>`).join('')}
      </div>
      ${st.fmt === 'pdf' ? `
      <div class="pdf-opts">
        <div class="field-label">Include in PDF</div>
        <label class="check"><input type="checkbox" data-opt="table" ${st.table ? 'checked' : ''} data-testid="pdf-table"><span>Attendance table</span></label>
        <label class="check"><input type="checkbox" data-opt="seatMaps" ${st.seatMaps ? 'checked' : ''} data-testid="pdf-seatmaps"><span>Seat maps <small class="subtle">— one page per deck, names in seats, absent seats light red, VIP / reserved labelled</small></span></label>
      </div>` : ''}
      <div class="export-summary">
        <span class="badge">${icon('file')}<span class="mono" data-testid="export-filename">${esc(name)}</span></span>
        ${st.fmt !== 'json' ? `<span class="badge badge--green">${c.present} present</span><span class="badge badge--red">${c.absent} absent</span>${c.unmarked ? `<span class="badge badge--amber">${c.unmarked} unmarked</span>` : ''}` : `<span class="badge">${plural(store.participants.length, 'participant')}</span>`}
      </div>
      <div class="ov-actions">
        <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-grad" data-act="go" data-testid="export-create" ${st.fmt === 'pdf' && !st.table && !st.seatMaps ? 'disabled' : ''}>${icon('zap')}<span>Create ${fmt.label}</span></button>
      </div>`;
  }

  async function generate() {
    const fmt = FORMATS.find((f) => f.id === st.fmt);
    const c = store.counts();
    if (fmt.id !== 'json' && c.unmarked > 0) {
      const choice = await choiceDialog({
        title: `${plural(c.unmarked, 'person is', 'people are')} unmarked`,
        message: 'How should they appear in the export?',
        options: [
          { value: 'absent', label: 'Mark them Absent', description: 'Saved to the list too (undo is available).', icon: 'userMinus', kind: 'danger' },
          { value: 'blank', label: 'Leave blank', description: 'Present column stays empty for them.', icon: 'minus' },
        ],
      });
      if (!choice) return;
      if (choice === 'absent') await store.markUnmarkedAbsent();
    }
    body.innerHTML = `<div class="export-busy">${icon('refresh', 'spin')}<strong>Creating ${esc(fmt.label)}…</strong></div>`;
    try {
      const name = exportFileName(store.event.name, store.event.date, fmt.ext);
      let blob;
      if (fmt.id === 'xlsx') blob = await toXLSX(buildExportTable(store), store);
      else if (fmt.id === 'csv') blob = toCSV(buildExportTable(store));
      else if (fmt.id === 'pdf') blob = await toPDF(store, { table: st.table, seatMaps: st.seatMaps });
      else blob = await toBackup(store);
      renderReady(makeFile(blob, name), blob, name, fmt);
    } catch (err) {
      console.error(err);
      toast(`Export failed: ${err.message || err}`, { kind: 'error', duration: 6000 });
      renderPick();
    }
  }

  function renderReady(file, blob, name, fmt) {
    const share = canShareFile(file);
    body.innerHTML = `
      <div class="export-ready" data-testid="export-ready">
        <span class="ready-icon">${icon('check')}</span>
        <strong>${esc(fmt.label)} ready</strong>
        <span class="mono subtle">${esc(name)} · ${formatBytes(blob.size)}</span>
      </div>
      <div class="ov-actions">
        <button type="button" class="btn btn-secondary" data-act="again">${icon('undo')}<span>Another format</span></button>
        <button type="button" class="btn ${share ? 'btn-secondary' : 'btn-primary'}" data-act="download" data-testid="export-download">${icon('download')}<span>Download</span></button>
        ${share ? `<button type="button" class="btn btn-primary" data-act="share" data-testid="export-share">${icon('share')}<span>Share…</span></button>` : ''}
      </div>
      <p class="field-hint">${share ? 'Share opens the iPad share sheet (AirDrop, Mail, Files, WhatsApp…).' : 'Downloads go to your Downloads folder (on iPad: Files → Downloads).'}</p>`;
    body.querySelector('[data-act=download]').addEventListener('click', () => {
      downloadFile(blob, name);
      toast('Download started', { kind: 'success', duration: 1800 });
    });
    body.querySelector('[data-act=share]')?.addEventListener('click', async () => {
      try {
        await shareFile(file, name);
      } catch (err) {
        if (err?.name !== 'AbortError') {
          downloadFile(blob, name);
          toast('Sharing was not possible, so the file was downloaded instead.', { kind: 'warn' });
        }
      }
    });
    body.querySelector('[data-act=again]').addEventListener('click', renderPick);
  }

  body.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fmt]');
    if (f) {
      st.fmt = f.dataset.fmt;
      renderPick();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') ov.close();
    if (act === 'go') generate();
  });
  body.addEventListener('change', (e) => {
    const opt = e.target.dataset.opt;
    if (opt) {
      st[opt] = e.target.checked;
      renderPick();
    }
  });
  renderPick();
  return ov.closed;
}
