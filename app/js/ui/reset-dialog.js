// Admin "Reset all" dialog: choose what to clear, then confirm.

import { h } from './dom.js';
import { openOverlay, actionsRow, confirmDialog, toast } from './dialogs.js';

export async function openResetDialog(ctx) {
  const { store } = ctx;
  const opts = [
    { key: 'attendance', label: 'Attendance marks & check-in times', checked: true },
    { key: 'remarks', label: 'Remarks', checked: false },
    { key: 'seats', label: 'Seat assignments', checked: false },
    { key: 'seatTypes', label: 'Seat types (Unavailable / Reserved / VIP)', checked: false },
  ];
  const boxes = opts.map((o) => {
    const input = h('input', { type: 'checkbox', checked: o.checked, dataset: { key: o.key } });
    return { o, input, label: h('label', { class: 'check' }, input, h('span', {}, o.label)) };
  });
  const content = h('div', { class: 'stack' }, h('p', { class: 'ov-message' }, 'Choose what to clear. The participant list, buses and event details are kept.'), ...boxes.map((b) => b.label));
  const ov = openOverlay({ title: 'Reset all', content, size: 'sm', icon: 'refresh', className: 'is-danger' });
  content.append(
    actionsRow([
      { label: 'Cancel', onClick: () => ov.close(null) },
      { label: 'Reset…', kind: 'danger', dataset: { testid: 'reset-go' }, onClick: () => ov.close(Object.fromEntries(boxes.map((b) => [b.o.key, b.input.checked]))) },
    ]),
  );
  const what = await ov.closed;
  if (!what || !Object.values(what).some(Boolean)) return false;
  const parts = opts.filter((o) => what[o.key]).map((o) => o.label.toLowerCase());
  const ok = await confirmDialog({
    title: 'Are you sure?',
    message: `This clears: ${parts.join(', ')} for all ${store.participants.length} participants.`,
    okLabel: 'Yes, reset',
    danger: true,
  });
  if (!ok) return false;
  await store.resetAll(what);
  toast('Reset complete', { kind: 'success', action: { label: 'Undo', onClick: () => store.undo() } });
  return true;
}
