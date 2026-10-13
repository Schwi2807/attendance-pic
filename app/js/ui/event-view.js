// Event tab: event details form, participant list, events on this device,
// backup & restore, display settings, admin & security.

import { h, esc, debounce } from './dom.js';
import { icon } from './icons.js';
import { toast, confirmDialog } from './dialogs.js';
import { openResetDialog } from './reset-dialog.js';
import { prettyDate } from '../utils/format.js';
import { describeConfig } from '../domain/layout.js';

let backupSection = null;
/** Lets the backup module plug its card in (see backup.js). */
export function setBackupSection(fn) {
  backupSection = fn;
}

export function createEventView(ctx) {
  const { store, admin } = ctx;
  const el = h('section', { class: 'view view-event', 'data-testid': 'event-view' });
  let focusKey = null;

  async function render() {
    const ev = store.event;
    const events = await store.listEvents();
    const c = store.counts();
    const cols = ev?.columns;
    el.innerHTML = `
      <div class="page-title"><div><h1>Event</h1><p>Details printed on every export, plus device settings.</p></div></div>
      <div class="event-grid">
        ${ev ? `
        <div class="card card-pad span-7">
          <div class="card-head"><div class="card-icon">${icon('calendar')}</div><div><h3>Event details</h3><p>Saved automatically as you type.</p></div></div>
          <form class="form-grid" data-testid="event-form" autocomplete="off">
            <label class="field"><span class="field-label">Event name</span><input class="input" name="name" value="${esc(ev.name)}" maxlength="80" data-testid="ev-name"></label>
            <label class="field"><span class="field-label">Date</span><input class="input" type="date" name="date" value="${esc(ev.date)}" data-testid="ev-date"></label>
            <label class="field"><span class="field-label">Venue</span><input class="input" name="venue" value="${esc(ev.venue)}" maxlength="80" placeholder="e.g. Port Dickson" data-testid="ev-venue"></label>
            <label class="field"><span class="field-label">PIC name</span><input class="input" name="picName" value="${esc(ev.picName)}" maxlength="80" placeholder="Person in charge" data-testid="ev-pic"></label>
          </form>
        </div>
        <div class="card card-pad span-5">
          <div class="card-head"><div class="card-icon card-icon--green">${icon('users')}</div><div><h3>Participant list</h3><p>${esc(ev.importMeta?.fileName || 'No file imported yet')}</p></div></div>
          <dl class="kv">
            <dt>Participants</dt><dd data-testid="ev-count">${c.total}</dd>
            <dt>Present / Absent</dt><dd>${c.present} / ${c.absent}</dd>
            <dt>Name · ID</dt><dd>${esc(cols?.name || '—')} · ${esc(cols?.id || '—')}</dd>
            <dt>Key info</dt><dd>${esc((cols?.keyInfo || []).join(', ') || '—')}</dd>
            <dt>Buses</dt><dd>${store.buses.length} · ${esc(describeConfig(store.template))} template</dd>
          </dl>
          ${cols ? `<label class="field mt-16"><span class="field-label">Phone column <small class="subtle">(shown in the Seating tab)</small></span>
            <select class="select" data-k="phone" data-testid="ev-phone">
              <option value="" ${store.phoneColumn() ? '' : 'selected'}>— None —</option>
              ${(cols.headers || []).filter((hd) => hd !== cols.name && hd !== cols.id).map((hd) => `<option value="${esc(hd)}" ${hd === store.phoneColumn() ? 'selected' : ''}>${esc(hd)}</option>`).join('')}
            </select></label>` : ''}
          <div class="row-wrap mt-16">
            <button class="btn btn-primary" type="button" data-act="import" data-testid="ev-import">${icon('upload')}<span>Import list</span></button>
          </div>
        </div>` : `
        <div class="card card-pad span-12">
          <div class="card-head"><div class="card-icon">${icon('upload')}</div><div><h3>No event yet</h3><p>Import a participant list to create your first event.</p></div></div>
          <button class="btn btn-primary" type="button" data-act="import" data-testid="ev-import">${icon('upload')}<span>Import list</span></button>
        </div>`}

        <div class="card card-pad span-6" data-slot="backup"></div>

        <div class="card card-pad span-6">
          <div class="card-head"><div class="card-icon card-icon--violet">${icon('list')}</div><div><h3>Events on this iPad</h3><p>Switch between trips. Each keeps its own list, buses and seats.</p></div></div>
          <ul class="list-plain" data-testid="event-list">
            ${events.length ? events.map((e) => `
              <li class="event-item ${e.id === ev?.id ? 'is-current' : ''}">
                <div class="grow"><strong>${esc(e.name)}</strong><small>${esc([e.date ? prettyDate(e.date) : '', e.venue].filter(Boolean).join(' · ') || 'No date')}</small></div>
                ${e.id === ev?.id ? '<span class="badge badge--brand">Open</span>' : `<button class="btn btn-sm btn-secondary" type="button" data-open="${esc(e.id)}">Open</button>`}
                <button class="icon-btn" type="button" data-delete="${esc(e.id)}" aria-label="Delete event ${esc(e.name)}">${icon('trash')}</button>
              </li>`).join('') : '<li class="subtle">No events yet.</li>'}
          </ul>
        </div>

        <div class="card card-pad span-6">
          <div class="card-head"><div class="card-icon card-icon--amber">${icon('shield')}</div><div><h3>Admin &amp; security</h3><p>Admin mode locks automatically after 5 minutes idle.</p></div></div>
          <div class="row-wrap">
            <span class="badge ${admin.unlocked ? 'badge--amber' : ''}" data-testid="admin-status">${icon(admin.unlocked ? 'unlock' : 'lock')} ${admin.unlocked ? 'Admin unlocked' : 'Locked'}</span>
            <span class="spacer"></span>
            <button class="btn btn-sm btn-secondary" type="button" data-act="lock">${admin.unlocked ? `${icon('lock')}<span>Lock now</span>` : `${icon('unlock')}<span>Unlock</span>`}</button>
            <button class="btn btn-sm btn-secondary" type="button" data-act="pin" data-testid="change-pin">${icon('key')}<span>Change PIN</span></button>
          </div>
          <p class="field-hint mt-16">Admin-only: seat types, bus layouts &amp; decks, adding/removing/renaming buses, the default template, restoring backups and resets.</p>
        </div>

        <div class="card card-pad span-6">
          <div class="card-head"><div class="card-icon">${icon('monitor')}</div><div><h3>Display</h3><p>Personal to this iPad.</p></div></div>
          <div class="stack">
            <div class="segmented" data-k="theme" role="group" aria-label="Theme">
              ${[['auto', 'monitor', 'Auto'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([v, ic, l]) => `<button type="button" data-theme-opt="${v}" aria-pressed="${store.settings.theme === v}">${icon(ic)}${l}</button>`).join('')}
            </div>
            <label class="switch" data-testid="mask-toggle"><input type="checkbox" data-k="mask" ${store.settings.maskIds ? 'checked' : ''}><span class="track"></span><span>Mask IDs and phone numbers on screen (e.g. AD••••••, 012-••• ••00)</span></label>
          </div>
        </div>

        ${ev ? `
        <div class="card card-pad span-12 danger-zone">
          <div class="card-head"><div class="card-icon card-icon--red">${icon('alert')}</div><div><h3>Reset</h3><p>Admin only. Clear marks, remarks, seats or seat types — always asks first, and can be undone right after.</p></div></div>
          <button class="btn btn-secondary" type="button" data-act="reset" data-testid="reset-all">${icon('refresh')}<span>Reset all…</span></button>
        </div>` : ''}
      </div>
      <div class="privacy-note mt-16">${icon('shield')}<div><strong>Private by design.</strong> Your lists, attendance and seats are stored only in this iPad's browser storage. The app makes no network requests except loading its own files. Keep a backup before deleting the app or clearing Safari data.</div></div>
      <p class="footer-note">Attendance PIC · works offline · v1.0</p>`;

    const backupSlot = el.querySelector('[data-slot=backup]');
    if (backupSection) backupSlot.replaceChildren(...backupSection(ctx));
    else backupSlot.remove();

    const form = el.querySelector('[data-testid=event-form]');
    if (form) {
      const saveField = debounce((name, value) => store.updateEvent({ [name]: value.trim() }), 350);
      form.addEventListener('input', (e) => {
        if (e.target.name) saveField(e.target.name, e.target.value);
      });
      form.addEventListener('change', (e) => {
        if (e.target.name) saveField.flush(e.target.name, e.target.value);
      });
      form.addEventListener('focusin', (e) => (focusKey = e.target.name));
      form.addEventListener('focusout', () => (focusKey = null));
      form.addEventListener('submit', (e) => e.preventDefault());
    }
    el.querySelectorAll('[data-act=import]').forEach((b) => b.addEventListener('click', () => ctx.openImport()));
    el.querySelector('[data-act=lock]').addEventListener('click', () => (admin.unlocked ? admin.lock() : admin.unlock()));
    el.querySelector('[data-act=pin]').addEventListener('click', () => admin.changePin());
    el.querySelector('[data-act=reset]')?.addEventListener('click', async () => {
      if (await admin.require('Reset all')) await openResetDialog(ctx);
    });
    el.querySelector('[data-k=theme]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-opt]');
      if (b) store.setSetting('theme', b.dataset.themeOpt);
    });
    el.querySelector('[data-k=mask]').addEventListener('change', (e) => store.setSetting('maskIds', e.target.checked));
    el.querySelector('[data-k=phone]')?.addEventListener('change', async (e) => {
      await store.setPhoneColumn(e.target.value);
      toast(e.target.value ? `Phone numbers from “${e.target.value}”` : 'Phone numbers hidden');
    });
    el.querySelector('[data-testid=event-list]').addEventListener('click', async (e) => {
      const open = e.target.closest('[data-open]');
      const del = e.target.closest('[data-delete]');
      if (open) {
        await store.loadEvent(open.dataset.open);
        toast(`Opened “${store.event.name}”`);
      } else if (del) {
        if (!(await admin.require('Deleting an event'))) return;
        const target = events.find((x) => x.id === del.dataset.delete);
        const ok = await confirmDialog({
          title: `Delete “${target?.name}”?`,
          message: 'Its participant list, attendance, buses and seats will be removed from this iPad. This cannot be undone — download a backup first if unsure.',
          okLabel: 'Delete event',
          danger: true,
        });
        if (ok) {
          await store.deleteEvent(del.dataset.delete);
          toast('Event deleted');
        }
      }
    });
  }

  return {
    el,
    onShow: render,
    onChange(d) {
      if (!el.isConnected) return;
      if (d.type === 'event' && focusKey) return; // don't clobber the field being typed in
      if (['all', 'event', 'settings', 'buses', 'participants'].includes(d.type)) render();
    },
    onAdminChange() {
      if (!el.isConnected) return;
      const badge = el.querySelector('[data-testid=admin-status]');
      const want = admin.unlocked ? 'Admin unlocked' : 'Locked';
      if (badge && !badge.textContent.includes(want)) render();
    },
  };
}
