// Admin bus layout editor: deck type, seats-per-row layout, rows, back bench,
// driver side — with a live preview rendered by the real engine.

import { h, esc } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, toast } from './dialogs.js';
import { renderBusSVG } from './bus-svg.js';
import { LAYOUTS, LAYOUT_KEYS, MIN_ROWS, MAX_ROWS, normalizeConfig, seatCount, DECK_NAMES } from '../domain/layout.js';

function layoutGlyph(key) {
  const { left, right } = LAYOUTS[key];
  const cells = [];
  let x = 2;
  for (let i = 0; i < left; i++, x += 8) cells.push(`<rect class="mini-seat" x="${x}" y="8" width="6.5" height="12" rx="2"/>`);
  x += 6;
  for (let i = 0; i < right; i++, x += 8) cells.push(`<rect class="mini-seat" x="${x}" y="8" width="6.5" height="12" rx="2"/>`);
  return `<svg viewBox="0 0 ${x + 2} 28" aria-hidden="true">${cells.join('')}</svg>`;
}

/**
 * @param {object} opts
 * @param {'bus'|'template'} opts.kind
 * @param {object} [opts.bus]
 */
export function openLayoutEditor(ctx, { kind = 'bus', bus = null } = {}) {
  const { store } = ctx;
  let cfg = normalizeConfig(kind === 'bus' ? bus.config : store.template);
  let name = bus?.name || '';
  let applyAll = false;
  const root = h('div', { class: 'layout-editor', 'data-testid': 'layout-editor' });
  const title = kind === 'bus' ? `Bus ${bus.name} — layout` : 'Default bus template';
  const subtitle = kind === 'bus' ? 'Each bus is independent.' : 'Used for buses added automatically.';
  const ov = openOverlay({ title, subtitle, content: root, size: 'xl', icon: 'layout' });

  function deckCard(key) {
    const d = cfg.decks[key];
    return `
      <div class="deck-card" data-deck="${key}">
        <h4>${cfg.deckType === 'double' ? `${DECK_NAMES[key]} deck` : 'Seats'}</h4>
        <div class="layout-opts" role="group" aria-label="Seats per row">
          ${LAYOUT_KEYS.map((k) => `<button type="button" class="layout-opt" data-layout="${k}" data-testid="layout-${key}-${k}" aria-pressed="${d.layout === k}" title="${esc(LAYOUTS[k].hint)}">${layoutGlyph(k)}<span>${k}</span></button>`).join('')}
        </div>
        <div class="row">
          <span class="grow field-label">Rows</span>
          <div class="stepper"><button type="button" class="icon-btn" data-step="-1" aria-label="Fewer rows" data-testid="rows-${key}-minus">${icon('minus')}</button><output data-testid="rows-${key}">${d.rows}</output><button type="button" class="icon-btn" data-step="1" aria-label="More rows" data-testid="rows-${key}-plus">${icon('plus')}</button></div>
        </div>
        <label class="switch" data-testid="bench-${key}"><input type="checkbox" data-bench ${d.backBench ? 'checked' : ''}><span class="track"></span><span>Full back bench <small class="subtle">(aisle seat on last row)</small></span></label>
      </div>`;
  }

  function render() {
    const total = seatCount(cfg);
    const preview = renderBusSVG({ id: bus?.id || 'preview', name: name || 'Preview', flipped: Boolean(bus?.flipped), config: cfg }, () => ({ state: 'available' }), { interactive: false });
    root.innerHTML = `
      <div class="stack">
        ${kind === 'bus' ? `<label class="field"><span class="field-label">Bus name</span><input class="input" data-k="name" value="${esc(name)}" maxlength="30" data-testid="bus-name-input"></label>` : ''}
        <div class="field"><span class="field-label">Deck type</span>
          <div class="segmented" data-k="deckType">
            <button type="button" data-v="single" aria-pressed="${cfg.deckType === 'single'}" data-testid="deck-single">Single deck</button>
            <button type="button" data-v="double" aria-pressed="${cfg.deckType === 'double'}" data-testid="deck-double">Double-decker</button>
          </div>
        </div>
        ${deckCard('L')}
        ${cfg.deckType === 'double' ? deckCard('U') : ''}
        <div class="field"><span class="field-label">Driver side</span>
          <div class="segmented" data-k="driverSide">
            <button type="button" data-v="right" aria-pressed="${cfg.driverSide === 'right'}">Right (Malaysia, UK)</button>
            <button type="button" data-v="left" aria-pressed="${cfg.driverSide === 'left'}">Left</button>
          </div>
        </div>
        ${kind === 'template' ? `<label class="check"><input type="checkbox" data-k="applyAll" ${applyAll ? 'checked' : ''}><span>Also apply to all ${store.buses.length} existing bus(es)</span></label>` : ''}
      </div>
      <div class="stack">
        <div class="preview-stats">
          <span class="badge badge--brand" data-testid="preview-seats">${total} seats</span>
          <span class="badge">${cfg.deckType === 'double' ? 'Double-decker' : 'Single deck'}</span>
          ${cfg.deckType === 'double' ? '<span class="badge">Labels L… / U…</span>' : ''}
        </div>
        <div class="preview-pane">${preview}</div>
        <div class="ov-actions">
          <button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-act="save" data-testid="save-layout">${icon('check')}<span>${kind === 'bus' ? 'Save layout' : 'Save template'}</span></button>
        </div>
      </div>`;
  }

  root.addEventListener('click', async (e) => {
    const t = e.target;
    const seg = t.closest('[data-k] [data-v]');
    if (seg) {
      const k = seg.closest('[data-k]').dataset.k;
      cfg = normalizeConfig({ ...cfg, [k]: seg.dataset.v });
      return render();
    }
    const lo = t.closest('[data-layout]');
    if (lo) {
      const deck = lo.closest('[data-deck]').dataset.deck;
      cfg = normalizeConfig({ ...cfg, decks: { ...cfg.decks, [deck]: { ...cfg.decks[deck], layout: lo.dataset.layout } } });
      return render();
    }
    const step = t.closest('[data-step]');
    if (step) {
      const deck = step.closest('[data-deck]').dataset.deck;
      const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, cfg.decks[deck].rows + Number(step.dataset.step)));
      cfg = normalizeConfig({ ...cfg, decks: { ...cfg.decks, [deck]: { ...cfg.decks[deck], rows } } });
      return render();
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') ov.close(false);
    if (act === 'save') await save();
  });
  root.addEventListener('change', (e) => {
    if (e.target.matches('[data-bench]')) {
      const deck = e.target.closest('[data-deck]').dataset.deck;
      cfg = normalizeConfig({ ...cfg, decks: { ...cfg.decks, [deck]: { ...cfg.decks[deck], backBench: e.target.checked } } });
      render();
    } else if (e.target.dataset.k === 'applyAll') {
      applyAll = e.target.checked;
    }
  });
  root.addEventListener('input', (e) => {
    if (e.target.dataset.k === 'name') name = e.target.value;
  });

  async function save() {
    if (!(await ctx.admin.require('Editing bus layouts'))) return;
    if (kind === 'bus') {
      const ok = await store.updateBusConfig(bus.id, cfg);
      if (!ok) return;
      if (name.trim() && name.trim() !== bus.name) await store.renameBus(bus.id, name);
      toast(`Bus ${name.trim() || bus.name} updated`, { kind: 'success' });
    } else {
      await store.setDefaultTemplate(cfg, { applyToAll: applyAll });
      toast('Default template saved', { kind: 'success' });
    }
    ov.close(true);
  }

  render();
  return ov.closed;
}
