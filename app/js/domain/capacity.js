// Capacity maths and automatic bus-count planning (pure functions).
//
// Usable seats = total seats − Unavailable − Reserved − VIP.
// Auto mode keeps the smallest number of buses (≥ 1) whose usable seats
// cover every participant who still needs a normal seat (people an admin
// seated in a Reserved / VIP seat already have one). New buses use the
// event's default template.

import { enumerateSeats, normalizeConfig, seatCount } from './layout.js';

export function busStats(bus, seatTypes, assignments) {
  const seats = enumerateSeats(bus.id, bus.config);
  const stats = { total: seats.length, unavailable: 0, reserved: 0, vip: 0, usable: 0, seated: 0, seatedRestricted: 0 };
  for (const s of seats) {
    const t = seatTypes.get(s.id)?.type;
    const taken = assignments?.has(s.id);
    if (t === 'unavailable') stats.unavailable++;
    else if (t === 'reserved') stats.reserved++;
    else if (t === 'vip') stats.vip++;
    else stats.usable++;
    if (taken) {
      if (t === 'reserved' || t === 'vip') stats.seatedRestricted++;
      else stats.seated++;
    }
  }
  // Everyone on board counts, including people an admin placed in a
  // Reserved / VIP seat; those seats count as capacity once occupied.
  stats.occupied = stats.seated + stats.seatedRestricted;
  stats.capacity = stats.usable + stats.seatedRestricted;
  return stats;
}

/** "One — 38/38 seated · 1 VIP · 1 reserved · 2 unavailable" */
export function busSummaryText(bus, s) {
  const extras = [];
  if (s.vip) extras.push(`${s.vip} VIP`);
  if (s.reserved) extras.push(`${s.reserved} reserved`);
  if (s.unavailable) extras.push(`${s.unavailable} unavailable`);
  return `${bus.name} — ${s.occupied}/${s.capacity} seated${extras.length ? ` · ${extras.join(' · ')}` : ''}`;
}

export function usableSeats(bus, seatTypes) {
  return busStats(bus, seatTypes).usable;
}

/**
 * Plans the bus list for auto mode.
 * @returns {{ keep: object[], addCount: number, remove: object[] }}
 *   keep   – existing buses that stay (in order)
 *   addCount – how many template buses to append
 *   remove – trailing existing buses that are no longer needed
 */
export function planAutoBuses({ buses, participantCount, seatTypes, template }) {
  const ordered = [...buses].sort((a, b) => a.order - b.order);
  const need = Math.max(participantCount, 0);
  const per = seatCount(normalizeConfig(template));
  if (!ordered.length) {
    return { keep: [], addCount: Math.min(50, Math.max(1, per > 0 ? Math.ceil(need / per) : 1)), remove: [] };
  }
  let usable = 0;
  let k = 0;
  // Use existing buses first, in order.
  while (k < ordered.length && (k === 0 || usable < need)) {
    usable += usableSeats(ordered[k], seatTypes);
    k++;
  }
  if (usable >= need) {
    return { keep: ordered.slice(0, k), addCount: 0, remove: ordered.slice(k) };
  }
  // Not enough: append template buses (fresh buses have no seat types).
  const addCount = per > 0 ? Math.ceil((need - usable) / per) : 0;
  return { keep: ordered, addCount: Math.min(addCount, 50), remove: [] };
}
