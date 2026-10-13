// Backup & restore card for the Event tab.
// Download: anyone. Restore: admin only (it replaces data).

import { h } from './dom.js';
import { icon } from './icons.js';
import { toast, confirmDialog } from './dialogs.js';
import { setBackupSection } from './event-view.js';

export function backupCard(ctx) {
  const { store, admin } = ctx;
  const head = h('div', { class: 'card-head', html: `<div class="card-icon card-icon--green">${icon('database')}</div><div><h3>Backup &amp; restore</h3><p>A backup holds the whole event: list, attendance, buses, seat types and seats.</p></div>` });
  const input = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', 'data-testid': 'restore-input' });
  const backupBtn = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    'data-testid': 'backup-download',
    disabled: !store.event,
    html: `${icon('download')}<span>Download backup</span>`,
    onclick: () => ctx.openExport({ fmt: 'json' }),
  });
  const restoreBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    'data-testid': 'backup-restore',
    html: `${icon(admin.unlocked ? 'upload' : 'lock')}<span>Restore backup…</span>`,
    onclick: () => {
      // Safari only opens the file picker from a direct tap, so when admin is
      // locked we unlock first and ask for a second tap.
      if (!admin.unlocked) {
        admin.require('Restoring a backup').then((ok) => ok && toast('Admin unlocked — tap “Restore backup” again.'));
        return;
      }
      admin.touch();
      input.value = '';
      input.click();
    },
  });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      const snap = JSON.parse(await f.text());
      const meta = store.validateBackup(snap);
      const exists = (await store.listEvents()).some((e) => e.id === snap.event.id);
      const ok = await confirmDialog({
        title: `Restore “${meta.name}”?`,
        message: `${meta.participants} participants, ${meta.buses} bus(es), saved ${meta.exportedAt ? new Date(meta.exportedAt).toLocaleString() : 'unknown'}. ${exists ? 'The copy of this event on this iPad will be REPLACED.' : 'It will be added as a new event on this iPad.'}`,
        okLabel: exists ? 'Replace with backup' : 'Restore',
        danger: exists,
      });
      if (!ok) return;
      await store.restoreBackup(snap);
      toast(`Restored “${meta.name}”`, { kind: 'success' });
    } catch (err) {
      toast(`Could not restore: ${err.message || err}`, { kind: 'error', duration: 6000 });
    }
  });
  const row = h('div', { class: 'row-wrap' }, backupBtn, restoreBtn, input);
  const hint = h('p', { class: 'field-hint mt-16' }, 'Habit: download a backup after check-in and before deleting the app or clearing Safari data. Restoring is admin-only.');
  return [head, row, hint];
}

setBackupSection(backupCard);
