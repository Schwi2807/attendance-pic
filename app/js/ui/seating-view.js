// Seating view: every bus stacked on the page with its live seat map,
// per-bus summary, capacity overview and (admin) bus management.

import { h, esc } from './dom.js';
import { icon } from './icons.js';
import { toast, promptDialog, choiceDialog } from './dialogs.js';
import { renderHero } from './hero.js';
import { renderBusSVG, seatStateFromStore } from './bus-svg.js';
import { openLayoutEditor } from './layout-editor.js';
import { describeConfig, computeGeometry } from '../domain/layout.js';
import { plural } from '../utils/format.js';
import { installSeatInteractions } from './seat-interactions.js';

const LEGEND = [
  ['available', 'Available'],
  ['assigned', 'Assigned'],
  ['absent', 'Assigned · absent'],
  ['unavailable', 'Unavailable'],
  ['reserved', 'Reserved'],
  ['vip', 'VIP'],
  ['selected', 'Selected'],
];

function legendSwatch(kind) {
  const cls = {
    available: 'seat seat--available',
    assigned: 'seat seat--assigned',
    absent: 'seat seat--assigned seat--absent',
    unavailable: 'seat seat--unavailable',
    reserved: 'seat seat--reserved',
    vip: 'seat seat--vip',
    selected: 'seat seat--selected',
  }[kind];
  const deco =
    kind === 'unavailable' ? '<path class="seat-cross" d="M5,4L17,14M17,4L5,14"/>' : kind === 'reserved' ? '<rect class="seat-hatch" x="1" y="1" width="20" height="16" rx="4"/>' : '';
  return `<svg viewBox="0 0 22 18" aria-hidden="true"><g class="${cls}"><rect class="seat-base" x="1" y="1" width="20" height="16" rx="4"/>${deco}<rect class="seat-back" x="16" y="3" width="3.5" height="12" rx="1.5"/></g></svg>`;
}

export function createSeatingView(ctx) {
  const { store, admin } = ctx;
  const el = h('section', { class: 'view view-seating', 'data-testid': 'seating-view' });
  /** Interaction state (seat assignment flows plug into this — see seat-interactions.js). */
  const ui = { selectedPid: null, selectedSeatId: null, mode: null };
  const api = { el, ui, render, refreshSeats, ctx, hooks: { panel: null, onSeatTap: null, toolbarExtras: null, banner: null } };
  let refs = null;

  function capacityBlock() {
    const cap = store.capacity();
    const pct = cap.needed ? Math.min(1, cap.needed / Math.max(cap.usable, 1)) : 0;
    const short = cap.usable < cap.needed;
    const C = 2 * Math.PI * 19;
    return `
      <div class="cap-summary" data-testid="capacity">
        <svg class="cap-ring ${short ? 'is-short' : ''}" viewBox="0 0 46 46" aria-hidden="true"><circle class="bg" cx="23" cy="23" r="19"/><circle class="fg" cx="23" cy="23" r="19" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/></svg>
        <div class="cap-text">
          <strong data-testid="bus-count">${plural(store.buses.length, 'bus', 'buses')} · ${cap.usable} usable seats</strong>
          <small>${cap.needed} participants · ${short ? `<span class="badge badge--red">short by ${cap.needed - cap.usable}</span>` : `${cap.usable - cap.needed} spare`} · ${store.event.busMode === 'auto' ? 'auto bus count' : 'manual bus count'}</small>
        </div>
      </div>`;
  }

  function busSummary(bus) {
    const s = store.busStats(bus);
    const extras = [];
    if (s.vip) extras.push(`${s.vip} VIP`);
    if (s.reserved) extras.push(`${s.reserved} reserved`);
    if (s.unavailable) extras.push(`${s.unavailable} unavailable`);
    return {
      text: `${bus.name} — ${s.seated}/${s.usable} seated${extras.length ? ` · ${extras.join(' · ')}` : ''}`,
      pct: s.usable ? Math.min(100, (s.seated / s.usable) * 100) : 0,
      stats: s,
    };
  }

  function busCard(bus) {
    const sum = busSummary(bus);
    const geo = computeGeometry(bus.id, bus.config);
    const card = h('article', { class: 'bus-card', dataset: { busId: bus.id }, 'data-testid': 'bus-card' });
    card.innerHTML = `
      <header class="bus-card-head">
        <div class="bus-name">
          <span class="bus-chip">${icon('bus')}</span>
          <div class="grow">
            <h3 data-testid="bus-title">${esc(bus.name)}</h3>
            <div class="bus-summary" data-testid="bus-summary">${esc(sum.text)}</div>
            <div class="bus-config">${esc(describeConfig(bus.config))} · ${geo.decks.reduce((n, d) => n + d.seats.length, 0)} seats</div>
          </div>
        </div>
        <div class="bus-actions">
          <button class="btn btn-sm btn-ghost" type="button" data-act="flip" data-testid="flip-bus" title="Flip facing direction">${icon('flip')}<span>Flip</span></button>
          <button class="btn btn-sm btn-soft admin-only" type="button" data-act="edit" data-testid="edit-bus">${icon('layout')}<span>Layout</span></button>
          <button class="icon-btn admin-only" type="button" data-act="more" aria-label="More bus actions" data-testid="bus-more">${icon('more')}</button>
        </div>
      </header>
      <div class="bus-meter"><span></span></div>
      <div class="bus-scroll"></div>`;
    card.querySelector('.bus-meter span').style.width = `${sum.pct}%`;
    drawBus(card, bus);
    return card;
  }

  function drawBus(card, bus) {
    const scroll = card.querySelector('.bus-scroll');
    scroll.innerHTML = renderBusSVG(bus, (seat) =>
      seatStateFromStore(store, seat, { selectedSeatId: ui.selectedSeatId, highlightPid: ui.selectedPid }),
    );
    const svg = scroll.querySelector('svg');
    const w = Number(svg.getAttribute('width'));
    svg.style.maxWidth = `${Math.round(w * 1.18)}px`;
    svg.style.minWidth = `${Math.round(w * 0.8)}px`;
  }

  function render() {
    if (!store.event || !store.participants.length) {
      el.replaceChildren(renderHero(ctx));
      refs = null;
      return;
    }
    el.innerHTML = `
      <div class="seat-layout ${api.hooks.panel ? '' : 'no-panel'}">
        <aside class="seat-panel" data-testid="seat-panel" ${api.hooks.panel ? '' : 'hidden'}></aside>
        <div class="seat-main">
          <div class="seat-toolbar">
            <button class="btn btn-secondary btn-sm panel-toggle" type="button" data-act="panel">${icon('users')}<span>People</span></button>
            <div class="cap-slot"></div>
            <div class="row-wrap toolbar-actions"></div>
          </div>
          <div class="banner-slot"></div>
          <div class="legend" aria-label="Legend">${LEGEND.map(([k, l]) => `<span class="legend-item">${legendSwatch(k)}${l}</span>`).join('')}</div>
          <div class="bus-list" data-testid="bus-list"></div>
        </div>
      </div>`;
    refs = {
      panel: el.querySelector('.seat-panel'),
      cap: el.querySelector('.cap-slot'),
      actions: el.querySelector('.toolbar-actions'),
      banner: el.querySelector('.banner-slot'),
      list: el.querySelector('.bus-list'),
    };
    refs.cap.outerHTML = capacityBlock();
    refs.cap = el.querySelector('.cap-summary');
    renderActions();
    renderBuses();
    api.hooks.panel?.(refs.panel);
    api.hooks.banner?.(refs.banner);
    el.querySelector('[data-act=panel]').addEventListener('click', () => refs.panel.classList.toggle('is-open'));
  }

  function renderActions() {
    if (!refs) return;
    const auto = store.event.busMode === 'auto';
    refs.actions.innerHTML = `
      ${api.hooks.toolbarExtras ? '<span class="extras-slot"></span>' : ''}
      <button class="btn btn-sm btn-secondary" type="button" data-act="manage" data-testid="manage-buses">${icon(admin.unlocked ? 'settings' : 'lock')}<span>Buses</span></button>`;
    if (api.hooks.toolbarExtras) refs.actions.querySelector('.extras-slot').replaceWith(...api.hooks.toolbarExtras());
    refs.actions.querySelector('[data-act=manage]').addEventListener('click', () => manageBuses(auto));
  }

  function renderBuses() {
    if (!refs) return;
    const frag = document.createDocumentFragment();
    for (const bus of [...store.buses].sort((a, b) => a.order - b.order)) frag.append(busCard(bus));
    refs.list.replaceChildren(frag);
  }

  /** Re-draws seat maps + summaries without rebuilding the page. */
  function refreshSeats() {
    if (!refs) return;
    for (const card of refs.list.querySelectorAll('.bus-card')) {
      const bus = store.buses.find((b) => b.id === card.dataset.busId);
      if (!bus) continue;
      drawBus(card, bus);
      const sum = busSummary(bus);
      card.querySelector('.bus-summary').textContent = sum.text;
      card.querySelector('.bus-meter span').style.width = `${sum.pct}%`;
    }
    const cap = el.querySelector('.cap-summary');
    if (cap) cap.outerHTML = capacityBlock();
  }

  async function manageBuses(auto) {
    if (!(await admin.require('Managing buses'))) return;
    renderActions();
    const choice = await choiceDialog({
      title: 'Manage buses',
      message: auto ? 'Auto mode adds buses until usable seats cover every participant.' : 'Manual mode: the bus count only changes when you add or remove buses.',
      options: [
        { value: 'template', label: 'Default bus template', description: 'Layout used for buses added automatically', icon: 'layout' },
        { value: 'add', label: 'Add a bus', description: 'Switches to manual bus count', icon: 'plus' },
        auto
          ? { value: 'manual', label: 'Switch to manual bus count', description: 'Keep the current buses fixed', icon: 'lock' }
          : { value: 'auto', label: 'Switch to auto bus count', description: 'Add / remove buses to fit everyone', icon: 'zap' },
      ],
    });
    if (choice === 'template') await openLayoutEditor(ctx, { kind: 'template' });
    else if (choice === 'add') {
      const bus = await store.addBus();
      toast(`Bus ${bus.name} added`, { kind: 'success' });
    } else if (choice === 'manual' || choice === 'auto') {
      await store.setBusMode(choice);
      toast(choice === 'auto' ? 'Auto bus count on' : 'Manual bus count on');
    }
  }

  async function busMore(bus) {
    if (!(await admin.require('Managing buses'))) return;
    const sorted = [...store.buses].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((b) => b.id === bus.id);
    const choice = await choiceDialog({
      title: `Bus ${bus.name}`,
      options: [
        { value: 'rename', label: 'Rename', icon: 'edit' },
        idx > 0 ? { value: 'up', label: 'Move up', icon: 'arrowUp' } : null,
        idx < sorted.length - 1 ? { value: 'down', label: 'Move down', icon: 'arrowDown' } : null,
        { value: 'remove', label: 'Remove bus', description: 'Passengers on it become unseated', icon: 'trash', kind: 'danger' },
      ].filter(Boolean),
    });
    if (choice === 'rename') {
      const name = await promptDialog({ title: 'Rename bus', label: 'Bus name', value: bus.name, maxLength: 30 });
      if (name) await store.renameBus(bus.id, name);
    } else if (choice === 'up' || choice === 'down') {
      await store.moveBus(bus.id, choice === 'up' ? -1 : 1);
    } else if (choice === 'remove') {
      if (await store.removeBus(bus.id)) toast(`Bus ${bus.name} removed`);
    }
  }

  el.addEventListener('click', async (e) => {
    const card = e.target.closest('.bus-card');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (card && act) {
      const bus = store.buses.find((b) => b.id === card.dataset.busId);
      if (!bus) return;
      if (act === 'flip') await store.flipBus(bus.id);
      else if (act === 'edit') {
        if (await admin.require('Editing bus layouts')) await openLayoutEditor(ctx, { kind: 'bus', bus });
      } else if (act === 'more') await busMore(bus);
      return;
    }
    const seatEl = e.target.closest('.seat[data-seat-id]');
    if (seatEl && api.hooks.onSeatTap) api.hooks.onSeatTap(seatEl.dataset.seatId, seatEl);
  });
  el.addEventListener('keydown', (e) => {
    const seatEl = e.target.closest?.('.seat[data-seat-id]');
    if (seatEl && (e.key === 'Enter' || e.key === ' ') && api.hooks.onSeatTap) {
      e.preventDefault();
      api.hooks.onSeatTap(seatEl.dataset.seatId, seatEl);
    }
  });

  api.onShow = () => render();
  api.onChange = (d) => {
    if (!el.isConnected) return;
    if (['all', 'participants', 'buses'].includes(d.type)) render();
    else if (['assignments', 'seatTypes', 'attendance'].includes(d.type)) {
      refreshSeats();
      api.hooks.onDataChange?.(d);
    } else if (d.type === 'settings' && d.key === 'maskIds') api.hooks.onDataChange?.(d);
    else if (d.type === 'event') {
      const cap = el.querySelector('.cap-summary');
      if (cap) cap.outerHTML = capacityBlock();
    }
  };
  api.onAdminChange = () => {
    if (!el.isConnected) return;
    renderActions();
    api.hooks.onAdminChange?.();
  };
  installSeatInteractions(api);
  return api;
}
