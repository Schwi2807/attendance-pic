// Seat assignment interactions for the seating view. Tap-tap only, no drag:
//   • tap a participant in the side panel, then tap a seat
//   • or tap an empty seat, then pick someone from a searchable sheet
//   • tap an occupied seat for details + Move / Swap / Unassign / Present / Absent
// Admins additionally get seat-type controls (Unavailable / Reserved / VIP +
// label), a "paint" tool to mark many seats quickly, and may seat people in
// Reserved / VIP seats.

import { h, esc, debounce } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, toast, choiceDialog, actionsRow } from './dialogs.js';
import { initials, norm, plural } from '../utils/format.js';
import { maskId, maskPhone } from '../utils/mask.js';
import { SEAT_TYPE_NAMES } from '../domain/model.js';

const TYPE_ICONS = { available: 'check', unavailable: 'ban', reserved: 'bookmark', vip: 'crown' };

export function installSeatInteractions(view) {
  const { ctx, ui } = view;
  const { store, admin } = ctx;
  let panelRefs = null;
  let panelQuery = '';

  const showId = (p) => (store.settings.maskIds ? maskId(p.studentId) : p.studentId);
  const showPhone = (p) => {
    const ph = store.phoneOf(p);
    return ph && store.settings.maskIds ? maskPhone(ph) : ph;
  };
  /** Phone number as a tap-to-call link (plain text while masked). */
  const phoneLink = (p) => {
    const ph = store.phoneOf(p);
    if (!ph) return '';
    if (store.settings.maskIds) return `<span class="phone-chip" data-testid="sheet-phone">${icon('phone')}${esc(maskPhone(ph))}</span>`;
    const tel = ph.replace(/[^\d+]/g, '');
    return `<a class="phone-chip" href="tel:${esc(tel)}" data-testid="sheet-phone">${icon('phone')}${esc(ph)}</a>`;
  };
  // Search matches name, ID, phone (digits only, so "0125551000" finds "012-555 1000")
  // and every other column of the list (programme, group…) — handy for
  // ticking a whole group before putting it on a bus.
  const haystack = (p) => {
    const ph = store.phoneOf(p);
    return `${norm(`${p.name} ${p.studentId} ${ph} ${Object.values(p.original || {}).join(' ')}`)} ${ph.replace(/\D/g, '')}`;
  };
  const seatInfo = (seatId) => store.seatIndex.get(seatId);
  const seatName = (seatId) => {
    const i = seatInfo(seatId);
    return i ? `${i.bus.name} · ${i.seat.label}` : seatId;
  };
  const statusOf = (pid) => store.attendance.get(pid)?.status || null;

  function clearMode({ keepSelection = false } = {}) {
    ui.mode = null;
    ui.fromSeatId = null;
    if (!keepSelection) {
      ui.selectedPid = null;
      ui.selectedSeatId = null;
    }
    renderBanner();
    renderPanelList();
    view.refreshSeats();
  }

  async function run(fn, success) {
    try {
      await fn();
      if (success) toast(success, { kind: 'success', duration: 1800, action: { label: 'Undo', onClick: () => store.undo() } });
      return true;
    } catch (err) {
      toast(err.message || String(err), { kind: 'error' });
      return false;
    }
  }

  // ── side panel ────────────────────────────────────────────────────────────
  view.hooks.panel = (panel) => {
    panel.innerHTML = `
      <div class="seat-panel-head">
        <h3>${icon('users')} Participants <span class="badge" data-testid="unseated-count"></span><button class="icon-btn panel-close" type="button" data-testid="panel-close" aria-label="Close the participants list">${icon('x')}</button></h3>
        <div class="row"><label class="search grow">${icon('search')}<input type="search" placeholder="Name, ID, phone…" data-testid="panel-search" autocomplete="off" spellcheck="false"></label>
          <button class="btn btn-secondary" type="button" data-testid="select-mode" aria-pressed="${Boolean(ui.selecting)}">${icon('check')}<span>${ui.selecting ? 'Done' : 'Select'}</span></button></div>
      </div>
      <ul class="panel-list" data-testid="panel-list"></ul>
      <div class="panel-foot" data-testid="select-bar" ${ui.selecting ? '' : 'hidden'}></div>`;
    panelRefs = { list: panel.querySelector('.panel-list'), search: panel.querySelector('input'), count: panel.querySelector('[data-testid=unseated-count]'), foot: panel.querySelector('.panel-foot'), panel };
    panelRefs.search.value = panelQuery;
    panelRefs.search.addEventListener(
      'input',
      debounce(() => {
        panelQuery = norm(panelRefs.search.value);
        renderPanelList();
      }, 90),
    );
    panel.querySelector('[data-testid=select-mode]').addEventListener('click', () => setSelecting(!ui.selecting));
    panel.querySelector('[data-testid=panel-close]').addEventListener('click', () => panel.classList.remove('is-open'));
    panelRefs.foot.addEventListener('click', onFootClick);
    panelRefs.list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pid]');
      if (!b) return;
      const pid = b.dataset.pid;
      if (ui.selecting) {
        if (ui.picked.has(pid)) ui.picked.delete(pid);
        else ui.picked.add(pid);
        renderPanelList();
        return;
      }
      if (ui.mode === 'paint') clearMode();
      ui.mode = null;
      ui.selectedSeatId = null;
      ui.selectedPid = ui.selectedPid === pid ? null : pid;
      renderPanelList();
      renderBanner();
      view.refreshSeats();
      if (ui.selectedPid) panelRefs.panel.classList.remove('is-open');
    });
    renderPanelList();
  };

  function personButton(p, { pickable = false } = {}) {
    const seat = store.seatLabelOf(p.id);
    const group = seat ? '' : store.busName(store.allocatedBusOf(p.id));
    const st = statusOf(p.id);
    const picked = pickable && ui.selecting && ui.picked.has(p.id);
    return `<li><button type="button" class="person ${ui.selectedPid === p.id && !ui.selecting ? 'is-selected' : ''} ${picked ? 'is-picked' : ''} ${st === 'present' ? 'is-present' : st === 'absent' ? 'is-absent' : ''}" data-pid="${p.id}" data-testid="person" ${pickable && ui.selecting ? `aria-pressed="${picked}"` : ''}>
      ${pickable && ui.selecting ? `<span class="pick-box" aria-hidden="true">${icon('check')}</span>` : ''}
      <span class="avatar">${esc(initials(p.name))}<span class="tick">${icon('check')}</span></span>
      <span class="p-main"><span class="p-name">${esc(p.name)}</span><span class="p-sub"><span class="mono" data-testid="person-id">${esc(showId(p))}</span>${(() => {
        const ph = showPhone(p);
        return ph ? `<span class="p-phone mono" data-testid="person-phone">${icon('phone')}${esc(ph)}</span>` : '';
      })()}${seat ? `<span class="seat-tag">${esc(seat.bus)} · ${esc(seat.label)}</span>` : group ? `<span class="seat-tag is-group" data-testid="person-group">Bus ${esc(group)}</span>` : ''}</span></span>
    </button></li>`;
  }

  function renderPanelList() {
    if (!panelRefs || !panelRefs.list.isConnected) return;
    const match = (p) => !panelQuery || haystack(p).includes(panelQuery);
    const unseated = store.participants.filter((p) => !store.seatOf.has(p.id));
    const seated = store.participants.filter((p) => store.seatOf.has(p.id));
    panelRefs.count.textContent = `${unseated.length} unseated`;
    const u = unseated.filter(match);
    const s = seated.filter(match);
    const btn = (p) => personButton(p, { pickable: true });
    panelRefs.list.innerHTML =
      `<li class="panel-group">Unseated · ${u.length}</li>${u.map(btn).join('') || '<li class="subtle panel-group">Everyone is seated 🎉</li>'}` +
      `<li class="panel-group">Seated · ${s.length}</li>${s.map(btn).join('')}`;
    renderFoot(u.concat(s));
  }

  // ── bus groups: select people, then put them on a bus or shuffle ─────────
  let visible = [];
  function renderFoot(list) {
    visible = list;
    if (!panelRefs.foot) return;
    panelRefs.foot.hidden = !ui.selecting;
    const n = ui.picked.size;
    panelRefs.foot.innerHTML = `
      <div class="row"><strong class="grow" data-testid="picked-count">${n} selected</strong>
        <button class="btn btn-sm btn-ghost" type="button" data-f="all" data-testid="pick-all">All shown</button>
        <button class="btn btn-sm btn-ghost" type="button" data-f="none">None</button></div>
      <div class="row">
        <button class="btn btn-sm btn-primary grow" type="button" data-f="assign" data-testid="pick-assign" ${n ? '' : 'disabled'}>${icon('bus')}<span>Put on bus…</span></button>
        <button class="btn btn-sm btn-secondary grow" type="button" data-f="random" data-testid="pick-random" ${n ? '' : 'disabled'}>${icon('sparkles')}<span>Random</span></button>
      </div>`;
  }

  function setSelecting(on) {
    ui.selecting = on;
    ui.picked = new Set();
    if (on) {
      ui.selectedPid = null;
      ui.mode = ui.mode === 'paint' ? ui.mode : null;
      panelRefs?.panel.classList.add('is-open');
    }
    const b = panelRefs?.panel.querySelector('[data-testid=select-mode]');
    if (b) {
      b.setAttribute('aria-pressed', String(on));
      b.querySelector('span').textContent = on ? 'Done' : 'Select';
    }
    renderPanelList();
    renderBanner();
    view.refreshSeats();
  }

  async function chooseBus(title, message) {
    return choiceDialog({
      title,
      message,
      options: [
        ...[...store.buses]
          .sort((a, b) => a.order - b.order)
          .map((b) => ({ value: b.id, label: `Bus ${b.name}`, description: `${Math.max(0, store.busRoomLeft(b.id))} free seats left`, icon: 'bus' })),
        { value: '__none', label: 'No bus', description: 'Remove them from any bus group', icon: 'minus' },
      ],
    });
  }

  function groupSummary(plan) {
    return [...plan.entries()].filter(([, l]) => l.length).map(([id, l]) => `${store.busName(id)} ${l.length}`).join(' · ');
  }

  async function onFootClick(e) {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (!f) return;
    if (f === 'all') visible.forEach((p) => ui.picked.add(p.id));
    else if (f === 'none') ui.picked.clear();
    else if (f === 'assign') {
      const pids = [...ui.picked];
      const busId = await chooseBus(`Put ${plural(pids.length, 'person', 'people')} on…`, 'People who already have a seat keep it; their bus group is used for auto-fill and the export.');
      if (!busId) return;
      // Allowed (it is the PIC's call), but say so when the bus cannot seat them all.
      const unseated = pids.filter((pid) => !store.seatOf.has(pid));
      const over = busId === '__none' ? 0 : Math.max(0, unseated.length - Math.max(0, store.busRoomLeft(busId, { ignore: new Set(unseated) })));
      await store.setBusGroup(pids, busId === '__none' ? '' : busId);
      ui.picked.clear();
      toast(busId === '__none' ? `Cleared the bus for ${pids.length}` : `${plural(pids.length, 'person', 'people')} → Bus ${store.busName(busId)}${over ? ` · ${over} over capacity` : ''}`, { kind: over ? 'warn' : 'success', action: { label: 'Undo', onClick: () => store.undo() } });
    } else if (f === 'random') {
      const res = await store.randomBusGroups([...ui.picked]);
      ui.picked.clear();
      if (!res.count) toast('Everyone selected already has a seat, so their bus is fixed.', { kind: 'warn' });
      else toast(`Randomly grouped ${res.count}: ${groupSummary(res.plan)}${res.overflow ? ` · ${res.overflow} over capacity` : ''}`, { kind: res.overflow ? 'warn' : 'success', duration: 5000, action: { label: 'Undo', onClick: () => store.undo() } });
    }
    renderPanelList();
  }

  async function busGroupsMenu() {
    const unseated = store.participants.filter((p) => !store.seatOf.has(p.id));
    const ungrouped = unseated.filter((p) => !store.allocatedBusOf(p.id));
    const grouped = unseated.filter((p) => store.allocatedBusOf(p.id));
    const choice = await choiceDialog({
      title: 'Bus groups',
      message: 'Decide which bus people take before seating them. Auto-fill then seats each person on their own bus.',
      options: [
        { value: 'pick', label: 'Pick people…', description: 'Tick people in the list, then put them on a bus or shuffle them', icon: 'check' },
        { value: 'random-new', label: `Randomly assign ${plural(ungrouped.length, 'person', 'people')} without a bus`, description: 'Balanced so every bus has about the same free seats', icon: 'sparkles' },
        { value: 'random-all', label: `Re-shuffle all ${unseated.length} without a seat`, description: 'Ignores the current groups', icon: 'refresh' },
        { value: 'clear', label: `Clear ${plural(grouped.length, 'bus group')}`, description: 'Seated people keep their seats', icon: 'minus', kind: 'danger' },
      ],
    });
    if (choice === 'pick') setSelecting(true);
    else if (choice === 'random-new' || choice === 'random-all') {
      const res = await store.randomBusGroups((choice === 'random-new' ? ungrouped : unseated).map((p) => p.id));
      if (!res.count) return toast('Nobody to group.', { kind: 'warn' });
      toast(`Randomly grouped ${res.count}: ${groupSummary(res.plan)}${res.overflow ? ` · ${res.overflow} over capacity` : ''}`, { kind: res.overflow ? 'warn' : 'success', duration: 5000, action: { label: 'Undo', onClick: () => store.undo() } });
    } else if (choice === 'clear') {
      if (!grouped.length) return;
      await store.setBusGroup(grouped.map((p) => p.id), '', `Cleared ${grouped.length} bus groups`);
      toast(`Cleared ${plural(grouped.length, 'bus group')}`, { action: { label: 'Undo', onClick: () => store.undo() } });
    }
  }

  // ── toolbar extras ────────────────────────────────────────────────────────
  view.hooks.toolbarExtras = () => [
    h('button', { class: 'btn btn-sm btn-secondary', type: 'button', 'data-testid': 'bus-groups', html: `${icon('users')}<span>Bus groups</span>`, onclick: busGroupsMenu }),
    h('button', { class: 'btn btn-sm btn-primary', type: 'button', 'data-testid': 'auto-fill', html: `${icon('sparkles')}<span>Auto-fill</span>`, onclick: autoFill }),
    h('button', { class: 'btn btn-sm btn-warn admin-only', type: 'button', 'data-testid': 'paint-types', html: `${icon('paint')}<span>Seat types</span>`, onclick: startPaint }),
  ];

  // ── banner (current mode) ─────────────────────────────────────────────────
  let bannerSlot = null;
  view.hooks.banner = (slot) => {
    bannerSlot = slot;
    renderBanner();
  };
  function renderBanner() {
    if (!bannerSlot || !bannerSlot.isConnected) return;
    let html = '';
    const name = (pid) => esc(store.byId.get(pid)?.name || '');
    if (ui.mode === 'move') {
      html = `<div class="mode-banner" data-testid="mode-banner">${icon('move')}<div class="grow">Moving <strong>${name(store.assignments.get(ui.fromSeatId))}</strong> from ${esc(seatName(ui.fromSeatId))} — tap a free seat, or an occupied seat to swap.</div><button class="btn btn-sm" type="button" data-cancel>Cancel</button></div>`;
    } else if (ui.mode === 'swap') {
      html = `<div class="mode-banner" data-testid="mode-banner">${icon('swap')}<div class="grow">Swap <strong>${name(store.assignments.get(ui.fromSeatId))}</strong> (${esc(seatName(ui.fromSeatId))}) — tap another passenger's seat.</div><button class="btn btn-sm" type="button" data-cancel>Cancel</button></div>`;
    } else if (ui.mode === 'paint') {
      const t = ui.paint.type;
      html = `<div class="mode-banner is-admin" data-testid="mode-banner">${icon('paint')}
        <div class="grow row-wrap"><strong>Seat types:</strong>
          <span class="segmented" data-paint>${['unavailable', 'reserved', 'vip', 'available'].map((k) => `<button type="button" data-paint-type="${k}" aria-pressed="${t === k}" data-testid="paint-${k}">${icon(TYPE_ICONS[k])}${SEAT_TYPE_NAMES[k]}</button>`).join('')}</span>
          ${t === 'reserved' || t === 'vip' ? `<input class="input" data-paint-label placeholder="Label (optional), e.g. Dr. Ahmad" value="${esc(ui.paint.label || '')}" maxlength="24">` : ''}
          <span>— tap seats</span></div>
        <button class="btn btn-sm" type="button" data-cancel data-testid="paint-done">Done</button></div>`;
    } else if (ui.selectedPid) {
      html = `<div class="mode-banner" data-testid="mode-banner">${icon('userCheck')}<div class="grow">Seating <strong>${name(ui.selectedPid)}</strong> — tap a free seat.</div><button class="btn btn-sm" type="button" data-cancel>Cancel</button></div>`;
    }
    bannerSlot.innerHTML = html;
    bannerSlot.querySelector('[data-cancel]')?.addEventListener('click', () => clearMode());
    bannerSlot.querySelector('[data-paint]')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-paint-type]');
      if (!b) return;
      ui.paint = { ...ui.paint, type: b.dataset.paintType };
      renderBanner();
    });
    bannerSlot.querySelector('[data-paint-label]')?.addEventListener('input', (e) => (ui.paint.label = e.target.value));
  }

  // ── seat taps ─────────────────────────────────────────────────────────────
  view.hooks.onSeatTap = async (seatId) => {
    const info = seatInfo(seatId);
    if (!info) return;
    const occupant = store.assignments.get(seatId);
    const type = store.seatTypeOf(seatId);

    if (ui.mode === 'paint') return paint(seatId);

    if (ui.mode === 'move' || ui.mode === 'swap') {
      const from = ui.fromSeatId;
      const mover = store.assignments.get(from);
      if (seatId === from) return clearMode();
      if (occupant) {
        const ok = await run(() => store.swapSeats(from, seatId, { admin: admin.unlocked }), `Swapped ${store.byId.get(mover)?.name} ⇄ ${store.byId.get(occupant)?.name}`);
        if (ok) clearMode();
        return;
      }
      if (ui.mode === 'swap') return toast('Tap a seat that has a passenger to swap with.', { kind: 'warn' });
      if (!(await canUse(seatId, type))) return;
      const ok = await run(() => store.assignSeat(seatId, mover, { admin: admin.unlocked }), `Moved to ${info.seat.label}`);
      if (ok) {
        clearMode();
        pop(seatId);
      }
      return;
    }

    if (ui.selectedPid) {
      const pid = ui.selectedPid;
      if (occupant === pid) return clearMode();
      if (occupant) {
        const name = store.byId.get(occupant)?.name;
        const mineSeat = store.seatOf.get(pid);
        const choice = await choiceDialog({
          title: `${info.seat.label} is taken`,
          message: `${name} is sitting here.`,
          options: [
            mineSeat ? { value: 'swap', label: `Swap seats with ${name}`, icon: 'swap' } : null,
            { value: 'replace', label: `Seat ${store.byId.get(pid)?.name} here`, description: `${name} becomes unseated`, icon: 'userMinus' },
          ].filter(Boolean),
        });
        if (choice === 'swap') {
          if (await run(() => store.swapSeats(mineSeat, seatId, { admin: admin.unlocked }), 'Swapped')) clearMode();
        } else if (choice === 'replace') {
          if (!(await canUse(seatId, type))) return;
          const ok = await run(async () => {
            await store.unassignSeat(seatId);
            await store.assignSeat(seatId, pid, { admin: admin.unlocked });
          }, `Seated in ${info.seat.label}`);
          if (ok) clearMode();
        }
        return;
      }
      if (!(await canUse(seatId, type))) return;
      const ok = await run(() => store.assignSeat(seatId, pid, { admin: admin.unlocked }), `${store.byId.get(pid)?.name} → ${info.seat.label}`);
      if (ok) {
        clearMode();
        pop(seatId);
      }
      return;
    }

    // Nothing selected: open the seat sheet.
    ui.selectedSeatId = seatId;
    view.refreshSeats();
    await seatSheet(seatId);
    if (ui.selectedSeatId === seatId && !ui.mode) {
      ui.selectedSeatId = null;
      view.refreshSeats();
    }
  };

  function pop(seatId) {
    requestAnimationFrame(() => {
      const el = view.el.querySelector(`.seat[data-seat-id="${CSS.escape(seatId)}"]`);
      el?.classList.add('is-pop');
    });
  }

  /** Checks seat type rules; offers admin unlock for Reserved / VIP seats. */
  async function canUse(seatId, type) {
    if (type === 'unavailable') {
      toast('That seat is unavailable.', { kind: 'warn' });
      return false;
    }
    if ((type === 'reserved' || type === 'vip') && !admin.unlocked) {
      const label = store.seatTypes.get(seatId)?.label;
      toast(`${type === 'vip' ? 'VIP' : 'Reserved'} seat${label ? ` (${label})` : ''} — admin only.`, { kind: 'warn' });
      return admin.require(`Seating someone in a ${type === 'vip' ? 'VIP' : 'reserved'} seat`);
    }
    return true;
  }

  // ── seat sheet ────────────────────────────────────────────────────────────
  async function seatSheet(seatId) {
    const info = seatInfo(seatId);
    const content = h('div', { class: 'stack', 'data-testid': 'seat-sheet' });
    const ov = openOverlay({ title: `Seat ${info.seat.label}`, subtitle: `Bus ${info.bus.name}${info.seat.deck && info.bus.config.deckType === 'double' ? ` · ${info.seat.deck === 'L' ? 'Lower' : 'Upper'} deck` : ''} · row ${info.seat.row}`, content, kind: 'sheet', size: 'sheet', icon: 'bus' });
    let draftType = store.seatTypeOf(seatId);
    let draftLabel = store.seatTypes.get(seatId)?.label || '';

    const render = () => {
      const pid = store.assignments.get(seatId);
      const type = store.seatTypeOf(seatId);
      const t = store.seatTypes.get(seatId);
      const p = pid ? store.byId.get(pid) : null;
      const st = pid ? statusOf(pid) : null;
      const bigCls = st === 'absent' ? 'is-absent' : type !== 'available' ? `is-${type}` : '';
      const typeBadge = type === 'available' ? '' : `<span class="badge ${type === 'vip' ? 'badge--vip' : type === 'reserved' ? 'badge--violet' : ''}">${icon(TYPE_ICONS[type])}${SEAT_TYPE_NAMES[type]}${t?.label ? ` · ${esc(t.label)}` : ''}</span>`;
      let html = `<div class="seat-sheet-head"><span class="seat-big ${bigCls}">${esc(info.seat.label)}</span><div class="grow">`;
      if (p) {
        html += `<strong data-testid="sheet-name">${esc(p.name)}</strong><div class="row-wrap mt-8"><span class="mono subtle">${esc(showId(p))}</span>${phoneLink(p)}
          <span class="badge ${st === 'present' ? 'badge--green' : st === 'absent' ? 'badge--red' : ''}" data-testid="sheet-status">${st ? st[0].toUpperCase() + st.slice(1) : 'Unmarked'}</span>${typeBadge}</div>`;
      } else {
        html += `<strong>${type === 'available' ? 'Empty seat' : SEAT_TYPE_NAMES[type] + ' seat'}</strong><div class="row-wrap mt-8">${typeBadge || '<span class="badge badge--green">Available</span>'}</div>`;
      }
      html += '</div></div>';

      if (p) {
        html += `<div class="sheet-actions">
          <button class="btn ${st === 'present' ? 'btn-success' : 'btn-secondary'}" type="button" data-a="present" data-testid="sheet-present">${icon('check')}<span>Present</span></button>
          <button class="btn ${st === 'absent' ? 'btn-danger' : 'btn-secondary'}" type="button" data-a="absent" data-testid="sheet-absent">${icon('x')}<span>Absent</span></button>
          <button class="btn btn-secondary" type="button" data-a="move" data-testid="sheet-move">${icon('move')}<span>Move</span></button>
          <button class="btn btn-secondary" type="button" data-a="swap" data-testid="sheet-swap">${icon('swap')}<span>Swap</span></button>
          <button class="btn btn-secondary" type="button" data-a="unassign" data-testid="sheet-unassign">${icon('userMinus')}<span>Unassign</span></button>
        </div>`;
      } else if (type === 'unavailable') {
        html += `<p class="ov-message">This seat cannot be used.${admin.unlocked ? '' : ' An admin can change that.'}</p>`;
      } else if ((type === 'reserved' || type === 'vip') && !admin.unlocked) {
        html += `<div class="notice notice--info">${icon('lock')}<div>${SEAT_TYPE_NAMES[type]} seat${t?.label ? ` for <strong>${esc(t.label)}</strong>` : ''}. Only an admin can seat someone here.</div></div>
          <button class="btn btn-secondary" type="button" data-a="unlock">${icon('unlock')}<span>Unlock admin</span></button>`;
      } else {
        html += `<div class="section-label">Assign someone</div>
          <label class="search">${icon('search')}<input type="search" placeholder="Search name, ID or phone" data-testid="picker-search" autocomplete="off" spellcheck="false"></label>
          <ul class="picker-list" data-testid="picker-list"></ul>`;
      }

      if (admin.unlocked) {
        html += `<hr class="hr"><div class="section-label">${icon('shield')} Seat type · admin</div>
          <div class="type-grid" data-testid="type-grid">${['available', 'unavailable', 'reserved', 'vip'].map((k) => `<button type="button" class="type-btn" data-type="${k}" aria-pressed="${draftType === k}" data-testid="type-${k}">${icon(TYPE_ICONS[k])}${SEAT_TYPE_NAMES[k]}</button>`).join('')}</div>
          ${draftType === 'reserved' || draftType === 'vip' ? `<label class="field"><span class="field-label">Label (optional)</span><input class="input" data-k="label" value="${esc(draftLabel)}" placeholder="e.g. Dr. Ahmad" maxlength="24" data-testid="type-label"></label>` : ''}
          <button class="btn btn-warn" type="button" data-a="saveType" data-testid="save-type">${icon('check')}<span>Apply seat type</span></button>`;
      }
      content.innerHTML = html;
      const picker = content.querySelector('[data-testid=picker-list]');
      if (picker) {
        const input = content.querySelector('[data-testid=picker-search]');
        const fill = () => {
          const q = norm(input.value);
          const list = store.participants
            .filter((x) => !q || haystack(x).includes(q))
            .sort((a, b) => Number(store.seatOf.has(a.id)) - Number(store.seatOf.has(b.id)) || a.order - b.order)
            .slice(0, 80);
          picker.innerHTML = list.map(personButton).join('') || '<li class="subtle">No match</li>';
        };
        input.addEventListener('input', debounce(fill, 80));
        fill();
        picker.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-pid]');
          if (!b) return;
          if (!(await canUse(seatId, store.seatTypeOf(seatId)))) return;
          const ok = await run(() => store.assignSeat(seatId, b.dataset.pid, { admin: admin.unlocked }), `${store.byId.get(b.dataset.pid)?.name} → ${info.seat.label}`);
          if (ok) {
            ov.close();
            pop(seatId);
          }
        });
      }
    };

    content.addEventListener('click', async (e) => {
      const tb = e.target.closest('[data-type]');
      if (tb) {
        draftType = tb.dataset.type;
        render();
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      const pid = store.assignments.get(seatId);
      if (a === 'present' || a === 'absent') {
        const cur = statusOf(pid);
        await store.setStatus(pid, cur === a ? null : a);
        render();
      } else if (a === 'move' || a === 'swap') {
        ui.mode = a;
        ui.fromSeatId = seatId;
        ui.selectedPid = null;
        ov.close();
        renderBanner();
        view.refreshSeats();
      } else if (a === 'unassign') {
        if (await run(() => store.unassignSeat(seatId), 'Unseated')) ov.close();
      } else if (a === 'unlock') {
        if (await admin.unlock()) render();
      } else if (a === 'saveType') {
        if (!(await admin.require('Setting seat types'))) return;
        const ok = await store.setSeatTypes([seatId], { type: draftType, label: draftType === 'reserved' || draftType === 'vip' ? draftLabel.trim() : '' });
        if (ok) {
          toast(`Seat ${info.seat.label}: ${SEAT_TYPE_NAMES[draftType]}`, { kind: 'success', duration: 1800 });
          ov.close();
        }
      }
    });
    content.addEventListener('input', (e) => {
      if (e.target.dataset.k === 'label') draftLabel = e.target.value;
    });
    const onAdmin = () => render();
    admin.addEventListener('change', onAdmin);
    render();
    await ov.closed;
    admin.removeEventListener('change', onAdmin);
  }

  // ── admin paint tool ──────────────────────────────────────────────────────
  async function startPaint() {
    if (!(await admin.require('Setting seat types'))) return;
    ui.mode = 'paint';
    ui.selectedPid = null;
    ui.selectedSeatId = null;
    ui.paint = ui.paint || { type: 'unavailable', label: '' };
    renderBanner();
    renderPanelList();
    view.refreshSeats();
  }

  async function paint(seatId) {
    if (!admin.unlocked) {
      clearMode();
      return toast('Admin mode locked — seat types are admin only.', { kind: 'warn' });
    }
    const current = store.seatTypeOf(seatId);
    const { type, label } = ui.paint;
    // Tapping a seat that already has this type resets it to Available.
    const next = current === type && type !== 'available' ? 'available' : type;
    await store.setSeatTypes([seatId], { type: next, label: next === 'reserved' || next === 'vip' ? (label || '').trim() : '' });
  }

  // ── auto-fill ─────────────────────────────────────────────────────────────
  async function autoFill() {
    const plan = store.planAutoFill({ skipAbsent: true });
    const planAll = store.planAutoFill({ skipAbsent: false });
    if (!planAll.waiting) return toast('Everyone already has a seat.', { kind: 'success' });
    const box = h('input', { type: 'checkbox', checked: true, 'data-testid': 'skip-absent' });
    const absentCount = planAll.waiting - plan.waiting;
    const msg = h('div', { class: 'stack' },
      h('p', { class: 'ov-message', html: `Seats <strong>${planAll.waiting}</strong> unseated participant(s) in list order, front to back, lower deck first. People with a <strong>bus group</strong> are seated on their own bus. Unavailable, Reserved and VIP seats are skipped. <strong>Nobody already seated is moved.</strong>` }),
      absentCount ? h('label', { class: 'check' }, box, h('span', {}, `Skip ${plural(absentCount, 'person', 'people')} marked Absent`)) : null,
      planAll.freeSeats < planAll.waiting ? h('div', { class: 'notice notice--warn', html: `${icon('alert')}<div>Only ${planAll.freeSeats} free seat(s) — ${planAll.waiting - planAll.freeSeats} will stay unseated.</div>` }) : null,
    );
    const ov = openOverlay({ title: 'Auto-fill seats?', content: msg, size: 'sm', icon: 'sparkles' });
    msg.append(actionsRow([{ label: 'Cancel', onClick: () => ov.close(false) }, { label: 'Auto-fill', kind: 'primary', icon: 'sparkles', dataset: { testid: 'confirm-autofill' }, onClick: () => ov.close(true) }]));
    if (!(await ov.closed)) return;
    const res = await store.autoFill({ skipAbsent: absentCount ? box.checked : false });
    clearMode();
    toast(`Seated ${res.list.length}${res.leftover ? ` · ${res.leftover} still without a seat` : ''}${res.busFull ? ` (${res.busFull} because their bus is full)` : ''}`, { kind: res.leftover ? 'warn' : 'success', duration: res.busFull ? 6000 : 3200, action: { label: 'Undo', onClick: () => store.undo() } });
  }

  // ── live updates ──────────────────────────────────────────────────────────
  view.hooks.onDataChange = () => {
    renderPanelList();
    if (ui.mode === 'move' || ui.mode === 'swap') {
      if (!store.assignments.has(ui.fromSeatId)) clearMode();
    }
  };
  view.hooks.onAdminChange = () => {
    if (!admin.unlocked && ui.mode === 'paint') clearMode();
  };

}
