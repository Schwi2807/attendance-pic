// Modals, bottom sheets, confirms, prompts and toasts.
// Built from plain DOM so every pixel follows the app's design system.

import { h, esc } from './dom.js';
import { icon } from './icons.js';

const root = () => document.getElementById('overlay-root');
const stack = [];

function trapFocus(panel, e) {
  if (e.key !== 'Tab') return;
  const f = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    last.focus();
    e.preventDefault();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus();
    e.preventDefault();
  }
}

/**
 * Generic overlay. `kind` = 'modal' (centred card) | 'sheet' (bottom sheet on
 * narrow screens, side-anchored card on wide screens).
 * Returns { el, body, close(value), closed: Promise }.
 */
export function openOverlay({ title, subtitle = '', content, kind = 'modal', size = 'md', dismissible = true, className = '', icon: ic = '' }) {
  const prevFocus = document.activeElement;
  let resolve;
  const closed = new Promise((r) => (resolve = r));
  const body = h('div', { class: 'ov-body' });
  if (content instanceof Node) body.append(content);
  else if (content) body.innerHTML = content;

  const head = h(
    'div',
    { class: 'ov-head' },
    ic ? h('div', { class: 'ov-icon', html: icon(ic) }) : null,
    h('div', { class: 'ov-titles' }, h('h2', { class: 'ov-title', id: `ov-t-${stack.length}` }, title || ''), subtitle ? h('p', { class: 'ov-sub' }, subtitle) : null),
    dismissible ? h('button', { class: 'icon-btn ov-close', 'aria-label': 'Close', html: icon('x'), onclick: () => close(undefined) }) : null,
  );
  const panel = h('div', { class: `ov-panel ov-${kind} ov-${size} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': `ov-t-${stack.length}` }, head, body);
  const backdrop = h('div', { class: `ov-backdrop ov-backdrop--${kind}` }, panel);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop && dismissible) backdrop.dataset.down = '1';
  });
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && dismissible && backdrop.dataset.down) close(undefined);
    delete backdrop.dataset.down;
  });
  const onKey = (e) => {
    if (stack.at(-1) !== api) return;
    if (e.key === 'Escape' && dismissible) {
      e.preventDefault();
      close(undefined);
    }
    trapFocus(panel, e);
  };
  document.addEventListener('keydown', onKey);

  let done = false;
  function close(value) {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('is-leaving');
    const idx = stack.indexOf(api);
    if (idx >= 0) stack.splice(idx, 1);
    setTimeout(() => backdrop.remove(), 180);
    document.body.classList.toggle('has-overlay', stack.length > 0);
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    resolve(value);
  }
  const api = { el: panel, body, head, close, closed };
  stack.push(api);
  root().append(backdrop);
  document.body.classList.add('has-overlay');
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    const auto = panel.querySelector('[autofocus]') || panel.querySelector('.ov-body input:not([type=checkbox]):not([type=radio]), .ov-body select, .ov-body textarea');
    (auto || panel.querySelector('.ov-actions .btn-primary') || panel).focus?.({ preventScroll: true });
  });
  panel.tabIndex = -1;
  return api;
}

export function closeAllOverlays() {
  [...stack].reverse().forEach((o) => o.close(undefined));
}

export function hasOverlay() {
  return stack.length > 0;
}

/** Row of buttons for the bottom of a dialog. */
export function actionsRow(buttons) {
  return h(
    'div',
    { class: 'ov-actions' },
    buttons.map((b) =>
      h(
        'button',
        {
          type: b.type || 'button',
          class: `btn ${b.kind ? `btn-${b.kind}` : 'btn-secondary'} ${b.class || ''}`,
          onclick: b.onClick,
          disabled: b.disabled,
          dataset: b.dataset,
          html: `${b.icon ? icon(b.icon) : ''}<span>${esc(b.label)}</span>`,
        },
      ),
    ),
  );
}

/** Yes/no confirmation. Resolves true / false. */
export function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'Cancel', danger = false, icon: ic }) {
  const content = h('div', {}, h('p', { class: 'ov-message' }, message || ''));
  const ov = openOverlay({ title, content, size: 'sm', icon: ic || (danger ? 'alert' : 'info'), className: danger ? 'is-danger' : '' });
  content.append(
    actionsRow([
      { label: cancelLabel, kind: 'secondary', onClick: () => ov.close(false), dataset: { action: 'cancel' } },
      { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => ov.close(true), dataset: { action: 'ok' } },
    ]),
  );
  return ov.closed.then((v) => v === true);
}

/** Single-field prompt. Resolves the string or null. */
export function promptDialog({ title, label, value = '', placeholder = '', okLabel = 'Save', maxLength = 60, inputMode }) {
  const input = h('input', { class: 'input', value, placeholder, maxlength: maxLength, autocomplete: 'off', inputmode: inputMode, autofocus: true });
  const form = h('form', { class: 'stack' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, label || ''), input));
  const ov = openOverlay({ title, content: form, size: 'sm' });
  form.append(
    actionsRow([
      { label: 'Cancel', onClick: () => ov.close(null) },
      { label: okLabel, kind: 'primary', type: 'submit' },
    ]),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ov.close(input.value.trim());
  });
  setTimeout(() => input.select(), 50);
  return ov.closed.then((v) => (v == null ? null : v));
}

/** Multiple-choice dialog. options: [{value, label, description, icon, kind}] */
export function choiceDialog({ title, message, options, cancelLabel = 'Cancel' }) {
  const content = h('div', { class: 'stack' }, message ? h('p', { class: 'ov-message' }, message) : null);
  const ov = openOverlay({ title, content, size: 'sm' });
  const list = h('div', { class: 'choice-list' });
  for (const o of options) {
    list.append(
      h('button', {
        type: 'button',
        class: `choice ${o.kind ? `choice--${o.kind}` : ''}`,
        dataset: { value: o.value },
        onclick: () => ov.close(o.value),
        html: `${o.icon ? `<span class="choice-icon">${icon(o.icon)}</span>` : ''}<span class="choice-text"><strong>${esc(o.label)}</strong>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span>${icon('chevronRight', 'choice-chev')}`,
      }),
    );
  }
  content.append(list, actionsRow([{ label: cancelLabel, onClick: () => ov.close(null) }]));
  return ov.closed.then((v) => v ?? null);
}

// ── Toasts ──────────────────────────────────────────────────────────────────
export function toast(message, { kind = 'info', action, duration = 3200 } = {}) {
  const host = document.getElementById('toast-root');
  const ic = { success: 'check', error: 'alert', warn: 'alert', info: 'info' }[kind] || 'info';
  const el = h('div', { class: `toast toast--${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('span', { class: 'toast-icon', html: icon(ic) }), h('span', { class: 'toast-msg' }, message));
  if (action) {
    el.append(
      h('button', {
        class: 'toast-action',
        onclick: () => {
          action.onClick();
          dismiss();
        },
        text: action.label,
      }),
    );
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  let t = setTimeout(dismiss, duration);
  el.addEventListener('pointerenter', () => clearTimeout(t));
  el.addEventListener('pointerleave', () => (t = setTimeout(dismiss, 1500)));
  function dismiss() {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 250);
  }
  while (host.children.length > 3) host.firstElementChild.remove();
  return dismiss;
}
