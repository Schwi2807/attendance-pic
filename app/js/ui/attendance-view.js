// Attendance list: sticky search + live counters + filters, big Present /
// Absent buttons, remarks, undo. Rows are patched in place so marking is
// instant even with hundreds of participants.

import { h, esc, debounce } from './dom.js';
import { icon } from './icons.js';
import { toast, choiceDialog } from './dialogs.js';
import { renderHero } from './hero.js';
import { openResetDialog } from './reset-dialog.js';
import { STATUS } from '../domain/model.js';
import { initials, norm } from '../utils/format.js';
import { maskId } from '../utils/mask.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unmarked', label: 'Unmarked', dot: 'unmarked' },
  { id: 'present', label: 'Present', dot: 'present' },
  { id: 'absent', label: 'Absent', dot: 'absent' },
  { id: 'unseated', label: 'Unseated', dot: 'unseated' },
];
const SORTS = [
  { id: 'original', label: 'List order' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'id', label: 'ID' },
  { id: 'seat', label: 'Seat' },
];

export function createAttendanceView(ctx) {
  const { store, admin } = ctx;
  const el = h('section', { class: 'view view-attendance', 'data-testid': 'attendance-view' });
  const ui = { q: '', filter: 'all', sort: 'original' };
  const rows = new Map();
  let refs = null;
  let hasList = false;

  const matchesFilter = (p) => {
    const a = store.attendance.get(p.id);
    switch (ui.filter) {
      case 'unmarked': return !a?.status;
      case 'present': return a?.status === STATUS.PRESENT;
      case 'absent': return a?.status === STATUS.ABSENT;
      case 'unseated': return !store.seatOf.has(p.id);
      default: return true;
    }
  };
  const matchesSearch = (p) => {
    if (!ui.q) return true;
    const seat = store.seatLabelOf(p.id);
    return p._search.includes(ui.q) || (seat && norm(seat.label) === ui.q);
  };

  function keyInfo(p) {
    const cols = store.event?.columns?.keyInfo || [];
    return cols.map((c) => p.extra?.[c] ?? p.original?.[c]).filter(Boolean).join(' · ');
  }

  function shell() {
    hasList = Boolean(store.event && store.participants.length);
    rows.clear();
    if (!hasList) {
      el.replaceChildren(renderHero(ctx));
      refs = null;
      return;
    }
    el.innerHTML = `
      <div class="att-head">
        <div class="att-top">
          <div class="stats" data-testid="counter">
            <div class="stat stat--present"><span class="stat-num" data-k="present">0</span><span class="stat-label">Present</span></div>
            <div class="stat stat--absent"><span class="stat-num" data-k="absent">0</span><span class="stat-label">Absent</span></div>
            <div class="stat stat--unmarked"><span class="stat-num" data-k="unmarked">0</span><span class="stat-label">Unmarked</span></div>
            <div class="stat"><span class="stat-num" data-k="total">0</span><span class="stat-label">Total</span></div>
            <div class="progress" aria-hidden="true"><span class="p-present"></span><span class="p-absent"></span></div>
          </div>
        </div>
        <div class="att-controls">
          <label class="search">${icon('search')}<input type="search" data-testid="search" placeholder="Search name, ID or seat" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"><button class="icon-btn clear" type="button" aria-label="Clear search" hidden>${icon('x')}</button></label>
          <select class="select sort-select" data-testid="sort" aria-label="Sort">${SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
          <button class="btn btn-secondary undo-btn" data-testid="undo" type="button" disabled>${icon('undo')}<span class="lbl">Undo</span></button>
          <button class="btn btn-secondary more-btn" data-testid="att-more" type="button" aria-label="More actions">${icon('more')}</button>
        </div>
        <div class="chips" role="toolbar" aria-label="Filter">
          ${FILTERS.map((f) => `<button class="chip" type="button" data-filter="${f.id}" aria-pressed="${ui.filter === f.id}">${f.dot ? `<i class="dot dot--${f.dot}"></i>` : ''}${f.label}<span class="count" data-count="${f.id}">0</span></button>`).join('')}
        </div>
      </div>
      <ul class="att-list" data-testid="att-list"></ul>
      <div class="list-empty" hidden>${icon('search')}<div>No one matches.</div></div>`;
    refs = {
      list: el.querySelector('.att-list'),
      empty: el.querySelector('.list-empty'),
      search: el.querySelector('input[type=search]'),
      clear: el.querySelector('.search .clear'),
      sort: el.querySelector('.sort-select'),
      undo: el.querySelector('[data-testid=undo]'),
    };
    refs.search.value = ui.q;
    refs.sort.value = ui.sort;
    const onSearch = debounce(() => {
      ui.q = norm(refs.search.value);
      refs.clear.hidden = !refs.search.value;
      applyList();
    }, 90);
    refs.search.addEventListener('input', onSearch);
    refs.clear.addEventListener('click', () => {
      refs.search.value = '';
      onSearch.flush();
      refs.search.focus();
    });
    refs.sort.addEventListener('change', () => {
      ui.sort = refs.sort.value;
      applyList();
    });
    el.querySelector('.chips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      ui.filter = b.dataset.filter;
      el.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      applyList();
    });
    refs.undo.addEventListener('click', async () => {
      const label = await store.undo();
      if (label) toast(`Undone: ${label}`);
    });
    el.querySelector('[data-testid=att-more]').addEventListener('click', moreMenu);
    refs.list.addEventListener('click', onListClick);

    for (const p of store.participants) {
      p._search = norm(`${p.name} ${p.studentId}`);
      rows.set(p.id, buildRow(p));
    }
    applyList();
    updateCounts();
    updateUndo();
  }

  function buildRow(p) {
    const li = h('li', { class: 'att-row', dataset: { pid: p.id }, 'data-testid': 'att-row' });
    li.innerHTML = `
      <div class="avatar" aria-hidden="true">${esc(initials(p.name))}<span class="tick">${icon('check')}</span></div>
      <div class="att-main">
        <div class="att-name" data-testid="att-name">${esc(p.name || '(no name)')}</div>
        <div class="att-meta"><span class="id mono" data-testid="att-id"></span><span class="seat-tag" data-testid="att-seat"></span><span class="info">${esc(keyInfo(p))}</span></div>
        <div class="att-remark" hidden>${icon('edit')}<span class="remark-text" data-testid="att-remark"></span></div>
      </div>
      <div class="att-side">
        <span class="att-time" data-testid="att-time"></span>
        <button class="icon-btn remark-btn" type="button" data-act="remark" aria-label="Remarks for ${esc(p.name)}">${icon('edit')}</button>
      </div>
      <div class="att-actions">
        <button class="mark mark--present" type="button" data-act="present" data-testid="btn-present" aria-pressed="false">${icon('check')}<span>Present</span></button>
        <button class="mark mark--absent" type="button" data-act="absent" data-testid="btn-absent" aria-pressed="false">${icon('x')}<span>Absent</span></button>
      </div>`;
    updateRow(p.id, li);
    return li;
  }

  function updateRow(pid, li = rows.get(pid)) {
    if (!li) return;
    const p = store.byId.get(pid);
    const a = store.getAttendance(pid);
    li.classList.toggle('is-present', a.status === STATUS.PRESENT);
    li.classList.toggle('is-absent', a.status === STATUS.ABSENT);
    li.dataset.status = a.status || 'unmarked';
    li.querySelector('[data-act=present]').setAttribute('aria-pressed', String(a.status === STATUS.PRESENT));
    li.querySelector('[data-act=absent]').setAttribute('aria-pressed', String(a.status === STATUS.ABSENT));
    const t = li.querySelector('.att-time');
    t.textContent = a.time || '—';
    t.classList.toggle('is-empty', !a.time);
    li.querySelector('.id').textContent = store.settings.maskIds ? maskId(p.studentId) : p.studentId || '—';
    const seat = store.seatLabelOf(pid);
    const st = li.querySelector('.seat-tag');
    st.classList.toggle('is-none', !seat);
    st.innerHTML = seat ? `${icon('bus')}${esc(seat.bus)} · ${esc(seat.label)}` : 'No seat';
    const rem = li.querySelector('.att-remark');
    rem.hidden = !a.remarks;
    rem.querySelector('.remark-text').textContent = a.remarks || '';
    li.querySelector('.remark-btn').classList.toggle('has-remark', Boolean(a.remarks));
  }

  function visibleList() {
    let list = store.participants.filter((p) => matchesFilter(p) && matchesSearch(p));
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (ui.sort === 'name') list = list.sort(byName);
    else if (ui.sort === 'id') list = list.sort((a, b) => String(a.studentId).localeCompare(String(b.studentId), undefined, { numeric: true }));
    else if (ui.sort === 'seat') {
      const key = (p) => store.seatLabelOf(p.id)?.order ?? Infinity;
      list = list.sort((a, b) => key(a) - key(b) || a.order - b.order);
    }
    return list;
  }

  function applyList() {
    if (!refs) return;
    const list = visibleList();
    const fragment = document.createDocumentFragment();
    for (const p of list) {
      const li = rows.get(p.id);
      li.classList.remove('is-leaving');
      fragment.append(li);
    }
    refs.list.replaceChildren(fragment);
    refs.empty.hidden = list.length > 0;
  }

  function updateCounts() {
    if (!refs) return;
    const c = store.counts();
    for (const k of ['present', 'absent', 'unmarked', 'total']) el.querySelector(`.stat-num[data-k=${k}]`).textContent = c[k];
    el.querySelector('[data-count=all]').textContent = c.total;
    el.querySelector('[data-count=unmarked]').textContent = c.unmarked;
    el.querySelector('[data-count=present]').textContent = c.present;
    el.querySelector('[data-count=absent]').textContent = c.absent;
    el.querySelector('[data-count=unseated]').textContent = c.unseated;
    const pct = (n) => (c.total ? `${(n / c.total) * 100}%` : '0');
    el.querySelector('.p-present').style.width = pct(c.present);
    el.querySelector('.p-absent').style.width = pct(c.absent);
    el.querySelector('[data-testid=counter]').setAttribute('aria-label', `${c.present} present, ${c.absent} absent, ${c.unmarked} unmarked of ${c.total}`);
  }

  function updateUndo() {
    if (!refs) return;
    refs.undo.disabled = !store.canUndo;
    refs.undo.title = store.canUndo ? `Undo: ${store.undoLabel}` : 'Nothing to undo';
    refs.undo.querySelector('.lbl').textContent = 'Undo';
  }

  async function onListClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const li = btn.closest('.att-row');
    const pid = li.dataset.pid;
    const act = btn.dataset.act;
    if (act === 'present' || act === 'absent') {
      const cur = store.getAttendance(pid).status;
      const next = cur === act ? null : act;
      await store.setStatus(pid, next);
      if (!matchesFilter(store.byId.get(pid))) {
        li.classList.add('is-leaving');
        setTimeout(() => {
          if (li.classList.contains('is-leaving')) applyList();
        }, 380);
      }
    } else if (act === 'remark') {
      editRemark(li, pid);
    }
  }

  function editRemark(li, pid) {
    if (li.querySelector('.remark-input')) return li.querySelector('.remark-input').focus();
    const a = store.getAttendance(pid);
    const input = h('input', { class: 'input remark-input', value: a.remarks || '', placeholder: 'Remark (e.g. late, sick, left early)', maxlength: 200, 'data-testid': 'remark-input', enterkeyhint: 'done' });
    li.querySelector('.att-remark').hidden = true;
    li.querySelector('.att-main').append(input);
    input.focus();
    let cancelled = false;
    const finish = async () => {
      input.remove();
      if (!cancelled) await store.setRemarks(pid, input.value.trim());
      updateRow(pid);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        cancelled = true;
        input.blur();
      }
    });
    input.addEventListener('blur', finish, { once: true });
  }

  async function moreMenu() {
    const c = store.counts();
    const choice = await choiceDialog({
      title: 'Attendance actions',
      options: [
        { value: 'absent', label: `Mark ${c.unmarked} unmarked as Absent`, description: 'Everyone not yet marked becomes Absent.', icon: 'userMinus' },
        { value: 'reset', label: 'Reset all…', description: 'Admin · clear marks, remarks or seats (with confirmation).', icon: 'refresh', kind: 'danger' },
      ],
    });
    if (choice === 'absent') {
      if (!c.unmarked) return toast('Everyone is already marked.');
      const n = await store.markUnmarkedAbsent();
      toast(`Marked ${n} as absent`, { action: { label: 'Undo', onClick: () => store.undo() } });
    } else if (choice === 'reset') {
      if (await admin.require('Reset all')) await openResetDialog(ctx);
    }
  }

  function onChange(d) {
    if (d.type === 'undo') return updateUndo();
    if (d.type === 'all' || d.type === 'participants' || (d.type === 'event' && hasList !== Boolean(store.event && store.participants.length))) {
      shell();
      return;
    }
    if (!refs) return;
    if (d.type === 'attendance') {
      if (d.pid) updateRow(d.pid);
      else for (const pid of rows.keys()) updateRow(pid);
      updateCounts();
      if (d.bulk || !d.pid) applyList();
      else {
        // A row that should now be visible (e.g. after undo) but is not → re-list.
        // Rows that stop matching are animated out by the click handler.
        const p = store.byId.get(d.pid);
        if (p && matchesFilter(p) && matchesSearch(p) && !rows.get(d.pid)?.isConnected) applyList();
      }
    } else if (d.type === 'assignments' || d.type === 'buses' || d.type === 'seatTypes') {
      for (const pid of rows.keys()) updateRow(pid);
      updateCounts();
      if (ui.filter === 'unseated' || ui.sort === 'seat') applyList();
    } else if (d.type === 'settings' && d.key === 'maskIds') {
      for (const pid of rows.keys()) updateRow(pid);
    } else if (d.type === 'event') {
      for (const p of store.participants) {
        const li = rows.get(p.id);
        if (li) li.querySelector('.info').textContent = keyInfo(p);
      }
    }
  }

  shell();
  return {
    el,
    onShow() {
      if (hasList !== Boolean(store.event && store.participants.length)) shell();
    },
    onChange,
  };
}
