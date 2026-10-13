// Seating view (placeholder until the bus layout engine lands).
import { h } from './dom.js';
import { renderHero } from './hero.js';

export function createSeatingView(ctx) {
  const el = h('section', { class: 'view', 'data-testid': 'seating-view' });
  const render = () => {
    if (!ctx.store.participants.length) el.replaceChildren(renderHero(ctx));
    else el.replaceChildren(h('div', { class: 'card card-pad' }, 'Bus seating is coming in the next milestone.'));
  };
  render();
  return { el, onShow: render };
}
