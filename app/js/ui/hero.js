// Empty state shown before any participant list is imported.

import { h } from './dom.js';
import { icon } from './icons.js';
import { toast } from './dialogs.js';

let illustration = () => staticBus();
/** Lets the bus renderer provide a live illustration (see bus-svg.js). */
export function setHeroIllustration(fn) {
  illustration = fn;
}

function staticBus() {
  const seats = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 118 + r * 40;
      const y = 26 + c * 30 + (c > 1 ? 16 : 0);
      const cls = (r * 4 + c) % 7 === 0 ? 'absent' : (r + c) % 3 === 0 ? 'free' : 'taken';
      seats.push(`<rect class="hs hs-${cls}" x="${x}" y="${y}" width="32" height="25" rx="6"/>`);
    }
  }
  return `<svg viewBox="0 0 470 190" role="img" aria-label="Bus seat map illustration">
    <rect class="hb-body" x="10" y="10" width="450" height="170" rx="26"/>
    <rect class="hb-glass" x="16" y="18" width="16" height="154" rx="8"/>
    <circle class="hb-wheel" cx="66" cy="44" r="13"/>
    ${seats.join('')}
  </svg>`;
}

async function loadSample(ctx) {
  try {
    const res = await fetch('samples/participants_sample.xlsx', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], 'participants_sample.xlsx', { type: blob.type });
    ctx.openImport({ file });
  } catch {
    toast('Sample data is not available offline. Import your own list instead.', { kind: 'warn' });
  }
}

export function renderHero(ctx) {
  const el = h('div', { class: 'hero', 'data-testid': 'hero' });
  el.innerHTML = `
    <div>
      <span class="badge badge--brand">${icon('shield')} Offline · Private · iPad-ready</span>
      <h1 class="mt-16">Attendance &amp; bus seating, <em>right on your iPad.</em></h1>
      <p>Import the participant list, tick people in as they board, seat them on a live bus map and hand the lecturer a clean Excel or PDF report. Nothing ever leaves this device.</p>
      <div class="hero-actions">
        <button class="btn btn-grad btn-lg" type="button" data-testid="hero-import">${icon('upload')}<span>Import participant list</span></button>
        <button class="btn btn-secondary btn-lg" type="button" data-testid="hero-sample">${icon('sparkles')}<span>Try sample data</span></button>
      </div>
      <div class="hero-points">
        <span>${icon('check')}Works offline</span>
        <span>${icon('check')}XLSX · CSV · TXT</span>
        <span>${icon('check')}Excel, CSV &amp; PDF export</span>
        <span>${icon('check')}Single &amp; double-decker buses</span>
      </div>
    </div>
    <div class="hero-art"></div>`;
  el.querySelector('.hero-art').innerHTML = illustration();
  el.querySelector('[data-testid=hero-import]').addEventListener('click', () => ctx.openImport());
  el.querySelector('[data-testid=hero-sample]').addEventListener('click', () => loadSample(ctx));
  return el;
}
