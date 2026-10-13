// Admin mode: PIN set on first launch, unlock with the PIN, auto-lock after
// 5 minutes without interaction (or manual lock). The PIN is stored only as
// a salted SHA-256 hash in this device's IndexedDB.

import { h, esc } from './dom.js';
import { icon } from './icons.js';
import { openOverlay, toast, confirmDialog } from './dialogs.js';
import { sha256Hex, randomSalt } from '../utils/crypto.js';

export const AUTO_LOCK_MS = 5 * 60 * 1000;
const MAX_TRIES = 5;
const COOLDOWN_MS = 30 * 1000;

/**
 * PIN pad overlay.
 * mode 'verify': one entry, auto-submits at `length` digits (if known).
 * mode 'set':    enter a new PIN (4–8 digits) then confirm it.
 * Resolves the PIN string, or null when cancelled.
 */
export function pinPad({ mode = 'verify', title, subtitle = '', length = 0, dismissible = true, check, onForgot }) {
  let step = mode === 'set' ? 'new' : 'verify';
  let first = '';
  let value = '';
  let busy = false;

  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const msg = h('p', { class: 'pin-msg' }, subtitle);
  const pad = h('div', { class: 'pinpad' });
  const okBtn = h('button', { type: 'button', class: 'btn btn-primary btn-block pin-ok', html: '<span>Next</span>' });
  const wrap = h('div', { class: 'pin-wrap' }, dots, msg, pad, okBtn);

  const ov = openOverlay({ title, content: wrap, size: 'pin', dismissible, icon: mode === 'set' ? 'key' : 'lock', className: 'pin-overlay' });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'forgot', '0', 'back'];
  for (const k of keys) {
    if (k === 'forgot') {
      pad.append(
        onForgot && mode === 'verify'
          ? h('button', { type: 'button', class: 'pin-key pin-key--text', text: 'Forgot?', onclick: () => { ov.close(null); onForgot(); } })
          : h('span', { class: 'pin-key pin-key--blank' }),
      );
    } else if (k === 'back') {
      pad.append(h('button', { type: 'button', class: 'pin-key pin-key--icon', 'aria-label': 'Delete', dataset: { key: 'back' }, html: icon('arrowDown', 'rot-90'), onclick: () => press('back') }));
    } else {
      pad.append(h('button', { type: 'button', class: 'pin-key', dataset: { digit: k }, text: k, onclick: () => press(k) }));
    }
  }

  const expected = () => (step === 'confirm' ? first.length : step === 'verify' ? length : 0);
  function render() {
    const n = Math.max(expected() || 4, value.length, step === 'new' ? 4 : 0);
    dots.innerHTML = Array.from({ length: n }, (_, i) => `<span class="pin-dot ${i < value.length ? 'is-on' : ''}"></span>`).join('');
    const label = step === 'new' ? 'Next' : step === 'confirm' ? 'Save PIN' : 'Unlock';
    okBtn.querySelector('span').textContent = label;
    okBtn.disabled = busy || value.length < 4;
    okBtn.hidden = step !== 'new' && expected() > 0;
  }
  function fail(text) {
    msg.textContent = text;
    msg.classList.add('is-error');
    wrap.classList.remove('shake');
    void wrap.offsetWidth;
    wrap.classList.add('shake');
    value = '';
    render();
  }
  async function submit() {
    if (busy || value.length < 4) return;
    if (step === 'new') {
      first = value;
      value = '';
      step = 'confirm';
      msg.classList.remove('is-error');
      msg.textContent = 'Enter the same PIN again to confirm.';
      render();
      return;
    }
    if (step === 'confirm') {
      if (value !== first) {
        step = 'new';
        first = '';
        fail('PINs did not match. Choose a new PIN.');
        return;
      }
      ov.close(value);
      return;
    }
    busy = true;
    render();
    const result = check ? await check(value) : true;
    busy = false;
    if (result === true) ov.close(value);
    else fail(typeof result === 'string' ? result : 'Wrong PIN. Try again.');
  }
  function press(k) {
    if (busy) return;
    msg.classList.remove('is-error');
    if (k === 'back') value = value.slice(0, -1);
    else if (value.length < 8) value += k;
    render();
    const exp = expected();
    if (exp && value.length === exp) submit();
  }
  okBtn.addEventListener('click', submit);
  const onKey = (e) => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('back');
    else if (e.key === 'Enter') submit();
    else return;
    e.preventDefault();
  };
  ov.el.addEventListener('keydown', onKey);
  render();
  return ov.closed.then((v) => (typeof v === 'string' ? v : null));
}

export class AdminSession extends EventTarget {
  constructor(store) {
    super();
    this.store = store;
    this.unlocked = false;
    this.lastActivity = 0;
    this.timer = null;
    this.tick = null;
    this.failures = 0;
    this.cooldownUntil = 0;
    const touch = () => this.touch();
    document.addEventListener('pointerdown', touch, { capture: true, passive: true });
    document.addEventListener('keydown', touch, { capture: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.unlocked && Date.now() - this.lastActivity >= AUTO_LOCK_MS) {
        this.lock('Admin mode locked after 5 minutes idle.');
      }
    });
  }

  get hasPin() {
    return Boolean(this.store.settings.pinHash);
  }

  emit() {
    this.dispatchEvent(new Event('change'));
  }

  get remainingMs() {
    return this.unlocked ? Math.max(0, AUTO_LOCK_MS - (Date.now() - this.lastActivity)) : 0;
  }

  touch() {
    if (!this.unlocked) return;
    this.lastActivity = Date.now();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.lock('Admin mode locked after 5 minutes idle.'), AUTO_LOCK_MS);
  }

  async hash(pin, salt) {
    return sha256Hex(`${salt}:${pin}`);
  }

  async savePin(pin) {
    const salt = randomSalt();
    const hash = await this.hash(pin, salt);
    await this.store.setSetting('pinSalt', salt);
    await this.store.setSetting('pinHash', hash);
    await this.store.setSetting('pinLength', pin.length);
  }

  async verify(pin) {
    const { pinHash, pinSalt } = this.store.settings;
    return Boolean(pinHash) && (await this.hash(pin, pinSalt)) === pinHash;
  }

  /** First launch: a PIN must exist before anything else. */
  async ensurePin() {
    if (this.hasPin) return;
    const pin = await pinPad({
      mode: 'set',
      title: 'Create an admin PIN',
      subtitle: 'Choose 4–8 digits. The PIN protects bus layouts, seat types, restores and resets on this iPad.',
      dismissible: false,
    });
    if (pin) {
      await this.savePin(pin);
      toast('Admin PIN saved. Unlock admin mode with the lock button.', { kind: 'success' });
    }
  }

  async unlock(reason = '') {
    if (this.unlocked) {
      this.touch();
      return true;
    }
    if (!this.hasPin) {
      await this.ensurePin();
      if (!this.hasPin) return false;
    }
    const pin = await pinPad({
      mode: 'verify',
      title: 'Admin PIN',
      subtitle: reason || 'Enter your PIN to unlock admin mode.',
      length: Number(this.store.settings.pinLength) || 0,
      check: async (p) => {
        if (Date.now() < this.cooldownUntil) return `Too many attempts. Wait ${Math.ceil((this.cooldownUntil - Date.now()) / 1000)} s.`;
        if (await this.verify(p)) {
          this.failures = 0;
          return true;
        }
        this.failures++;
        if (this.failures >= MAX_TRIES) {
          this.failures = 0;
          this.cooldownUntil = Date.now() + COOLDOWN_MS;
          return 'Too many attempts. Wait 30 s.';
        }
        return `Wrong PIN. ${MAX_TRIES - this.failures} attempt(s) left.`;
      },
      onForgot: () => this.forgotPin(),
    });
    if (!pin) return false;
    this.unlocked = true;
    document.documentElement.classList.add('is-admin');
    this.touch();
    clearInterval(this.tick);
    this.tick = setInterval(() => this.emit(), 1000);
    this.emit();
    toast('Admin mode unlocked', { kind: 'success', duration: 1800 });
    return true;
  }

  lock(message = '') {
    if (!this.unlocked) return;
    this.unlocked = false;
    clearTimeout(this.timer);
    clearInterval(this.tick);
    document.documentElement.classList.remove('is-admin');
    this.emit();
    if (message) toast(message, { kind: 'info' });
  }

  /** Gate for admin-only actions: prompts for the PIN when locked. */
  async require(what = 'This action') {
    if (this.unlocked) {
      this.touch();
      return true;
    }
    return this.unlock(`${what} needs admin mode. Enter your PIN.`);
  }

  async changePin() {
    if (!(await this.require('Changing the PIN'))) return;
    const pin = await pinPad({ mode: 'set', title: 'New admin PIN', subtitle: 'Choose 4–8 digits.' });
    if (!pin) return;
    await this.savePin(pin);
    toast('PIN changed', { kind: 'success' });
  }

  async forgotPin() {
    const ok = await confirmDialog({
      title: 'Forgot the PIN?',
      message:
        'The PIN cannot be recovered. The only way to reset it is to erase ALL data stored by this app on this device (events, attendance, seats). Download a backup first if you can — backups can be restored after you set a new PIN.',
      okLabel: 'Erase everything…',
      danger: true,
    });
    if (!ok) return;
    const typed = await new Promise((resolve) => {
      const input = h('input', { class: 'input', placeholder: 'Type ERASE', autocomplete: 'off', autocapitalize: 'characters' });
      const content = h('form', { class: 'stack' }, h('p', { class: 'ov-message', html: `This cannot be undone. Type <strong>${esc('ERASE')}</strong> to confirm.` }), input);
      const ov = openOverlay({ title: 'Erase all app data', content, size: 'sm', icon: 'trash', className: 'is-danger' });
      const btn = h('button', { type: 'submit', class: 'btn btn-danger', text: 'Erase this device' });
      content.append(h('div', { class: 'ov-actions' }, h('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => ov.close(null) }), btn));
      content.addEventListener('submit', (e) => {
        e.preventDefault();
        ov.close(input.value.trim());
      });
      ov.closed.then(resolve);
    });
    if (typed !== 'ERASE') return;
    await this.store.eraseEverything();
    location.reload();
  }
}
