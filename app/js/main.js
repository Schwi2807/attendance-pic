// App bootstrap: theme, top bar, routing between views, service worker.

import { store } from './store.js';
import { AdminSession } from './ui/admin.js';
import { confirmDialog, toast, hasOverlay } from './ui/dialogs.js';
import { esc } from './ui/dom.js';
import { icon, logo } from './ui/icons.js';
import { createAttendanceView } from './ui/attendance-view.js';
import { createSeatingView } from './ui/seating-view.js';
import { createEventView } from './ui/event-view.js';
import { openImport } from './ui/import-flow.js';
import { openExport } from './ui/export-flow.js';
import { prettyDate } from './utils/format.js';

const admin = new AdminSession(store);
store.confirm = (opts) => confirmDialog(opts);

const ROUTES = [
  { id: 'attendance', label: 'Attendance', icon: 'users', create: createAttendanceView },
  { id: 'seating', label: 'Seating', icon: 'bus', create: createSeatingView },
  { id: 'event', label: 'Event', icon: 'settings', create: createEventView },
];

const ctx = {
  store,
  admin,
  navigate,
  openImport: (opts) => openImport(ctx, opts),
  openExport: () => openExport(ctx),
};
const views = new Map();
let current = null;

// ── theme ───────────────────────────────────────────────────────────────────
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// ── top bar ─────────────────────────────────────────────────────────────────
const topbar = document.getElementById('topbar');
function renderTopbar() {
  const ev = store.event;
  const sub = ev ? [ev.name, ev.date ? prettyDate(ev.date) : ''].filter(Boolean).join(' · ') : 'Offline attendance & seating';
  topbar.innerHTML = `
    <div class="topbar-inner">
      <div class="brand">
        ${logo()}
        <div class="brand-text">
          <div class="brand-name">Attendance PIC</div>
          <div class="brand-event" data-testid="brand-event">${esc(sub)}</div>
        </div>
      </div>
      <nav class="tabs" role="tablist" aria-label="Sections">
        ${ROUTES.map((r) => `<a class="tab" role="tab" href="#/${r.id}" data-route="${r.id}" aria-selected="${current === r.id}">${icon(r.icon)}<span>${r.label}</span></a>`).join('')}
      </nav>
      <div class="top-actions">
        <span class="badge badge--amber offline-pill" title="Working offline">${icon('wifiOff')} Offline</span>
        <span class="save-state" data-testid="save-state">${icon('check')}<span>Saved</span></span>
        <button class="admin-pill" data-testid="admin-toggle" type="button"></button>
        <button class="btn btn-grad btn-sm" data-testid="open-export" type="button" ${store.participants.length ? '' : 'disabled'}>${icon('share')}<span>Export</span></button>
      </div>
    </div>`;
  topbar.querySelector('[data-testid="admin-toggle"]').addEventListener('click', () => (admin.unlocked ? admin.lock() : admin.unlock()));
  topbar.querySelector('[data-testid="open-export"]').addEventListener('click', () => ctx.openExport());
  renderAdminPill();
}

function renderAdminPill() {
  const pill = topbar.querySelector('.admin-pill');
  if (!pill) return;
  if (admin.unlocked) {
    const s = Math.ceil(admin.remainingMs / 1000);
    pill.innerHTML = `${icon('unlock')}<span class="lbl">ADMIN</span><span class="timer">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`;
    pill.setAttribute('aria-label', 'Admin mode on — tap to lock');
    pill.dataset.state = 'unlocked';
  } else {
    pill.innerHTML = `${icon('lock')}<span class="lbl">Admin</span>`;
    pill.setAttribute('aria-label', 'Unlock admin mode');
    pill.dataset.state = 'locked';
  }
}

function renderSaveState() {
  const el = topbar.querySelector('.save-state');
  if (!el) return;
  const saving = store.saving > 0;
  el.classList.toggle('is-saving', saving);
  el.querySelector('span').textContent = saving ? 'Saving…' : 'Saved';
  el.querySelector('svg').outerHTML = icon(saving ? 'refresh' : 'check');
}

// ── routing ─────────────────────────────────────────────────────────────────
function routeFromHash() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return ROUTES.some((r) => r.id === id) ? id : 'attendance';
}

export function navigate(id) {
  if (location.hash !== `#/${id}`) location.hash = `#/${id}`;
  else show(id);
}

function show(id) {
  const main = document.getElementById('view');
  if (!views.has(id)) views.set(id, ROUTES.find((r) => r.id === id).create(ctx));
  const view = views.get(id);
  if (current !== id || !main.contains(view.el)) {
    views.get(current)?.onHide?.();
    main.replaceChildren(view.el);
    current = id;
    view.el.classList.remove('view');
    void view.el.offsetWidth;
    view.el.classList.add('view');
  }
  view.onShow?.();
  topbar.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.route === id)));
  document.title = `${ROUTES.find((r) => r.id === id).label} · Attendance PIC`;
}

// ── boot ────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    await store.init();
  } catch (err) {
    document.getElementById('view').innerHTML = `<div class="hero"><div><h1>Storage unavailable</h1><p>${esc(err.message || err)}</p><p class="muted">Private Browsing can block storage. Open the app from the Home Screen or a normal Safari tab.</p></div></div>`;
    console.error(err);
    return;
  }
  applyTheme(store.settings.theme);
  renderTopbar();

  store.addEventListener('change', (e) => {
    const t = e.detail.type;
    if (t === 'saving' || t === 'saved') return renderSaveState();
    if (t === 'all' || t === 'event' || t === 'participants') renderTopbar();
    if (t === 'settings' && e.detail.key === 'theme') applyTheme(store.settings.theme);
    for (const v of views.values()) v.onChange?.(e.detail);
  });
  admin.addEventListener('change', () => {
    renderAdminPill();
    for (const v of views.values()) v.onAdminChange?.();
  });

  window.addEventListener('hashchange', () => show(routeFromHash()));
  show(routeFromHash());
  setOnline();
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);

  // Ask the browser to keep our storage (Safari may otherwise evict data of
  // sites that are not used for a while).
  navigator.storage?.persist?.().catch(() => {});

  registerServiceWorker();
  await admin.ensurePin();
}

function setOnline() {
  document.documentElement.classList.toggle('is-offline', !navigator.onLine);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      const offerUpdate = (worker) => {
        toast('A new version of the app is ready.', {
          duration: 12000,
          action: {
            label: 'Reload',
            onClick: () => {
              sessionStorage.setItem('swUpdateRequested', '1');
              worker.postMessage({ type: 'SKIP_WAITING' });
            },
          },
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(nw);
          if (nw.state === 'activated' && !navigator.serviceWorker.controller) {
            toast('Ready to work offline', { kind: 'success', duration: 2600 });
          }
        });
      });
    })
    .catch((err) => console.warn('Service worker registration failed', err));
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !sessionStorage.getItem('swUpdateRequested')) return;
    reloading = true;
    sessionStorage.removeItem('swUpdateRequested');
    location.reload();
  });
}

// Keyboard shortcut for hardware keyboards: ⌘/Ctrl+Z = undo.
document.addEventListener('keydown', async (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !hasOverlay()) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    const label = await store.undo();
    if (label) toast(`Undone: ${label}`);
  }
});

boot();
