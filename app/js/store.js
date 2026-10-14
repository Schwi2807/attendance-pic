// ─────────────────────────────────────────────────────────────────────────────
// App store: in-memory state + every action the UI can perform.
//
// Each action writes through the repository first (autosave), then updates
// memory and emits a `change` event so views re-render. Views never call the
// repository themselves.
// ─────────────────────────────────────────────────────────────────────────────

import { createRepository, SeatTakenError } from './repo/repository.js';
import { createEvent, createBus, emptyAttendance, STATUS, SCHEMA_VERSION } from './domain/model.js';
import { enumerateSeats, normalizeConfig, nextBusName, parseSeatId } from './domain/layout.js';
import { planAutoBuses, busStats } from './domain/capacity.js';
import { hhmm, norm } from './utils/format.js';
import { buildParticipants, guessPhoneColumn } from './io/importer.js';
import { BACKUP_FORMAT } from './repo/errors.js';

const UNDO_LIMIT = 50;

export class Store extends EventTarget {
  constructor() {
    super();
    this.repo = null;
    this.settings = { theme: 'auto', maskIds: false, pinHash: '', pinSalt: '', pinLength: 0, lastEventId: '' };
    this.event = null;
    this.participants = [];
    this.byId = new Map();
    this.attendance = new Map(); // participantId -> record
    this.buses = [];
    this.seatTypes = new Map(); // seatId -> { type, label }
    this.assignments = new Map(); // seatId -> participantId
    this.seatOf = new Map(); // participantId -> seatId
    this.seatIndex = new Map(); // seatId -> { seat, bus }
    this.undoStack = [];
    this.saving = 0;
    this.lastSavedAt = null;
    /** Injected by the UI: async ({title, message, okLabel, cancelLabel, danger}) => boolean */
    this.confirm = async () => true;
  }

  // ── plumbing ──────────────────────────────────────────────────────────────
  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent('change', { detail: { type, ...detail } }));
  }

  /** Wraps a repository write so the UI can show "Saving… / Saved". */
  async save(fn) {
    this.saving++;
    this.emit('saving');
    try {
      return await fn();
    } finally {
      this.saving--;
      this.lastSavedAt = new Date();
      this.emit('saved');
    }
  }

  pushUndo(label, undo) {
    this.undoStack.push({ label, undo });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.emit('undo');
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get undoLabel() {
    return this.undoStack.at(-1)?.label || '';
  }

  async undo() {
    const item = this.undoStack.pop();
    if (!item) return null;
    await item.undo();
    this.emit('undo');
    return item.label;
  }

  get sessionId() {
    return this.event?.activeSessionId || null;
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  async init() {
    this.repo = await createRepository();
    for (const key of Object.keys(this.settings)) {
      const v = await this.repo.getSetting(key);
      if (v !== undefined) this.settings[key] = v;
    }
    let eventId = this.settings.lastEventId;
    if (!eventId || !(await this.repo.getEvent(eventId))) {
      eventId = (await this.repo.listEvents())[0]?.id || '';
    }
    if (eventId) await this.loadEvent(eventId);
    this.emit('all');
  }

  async setSetting(key, value) {
    this.settings[key] = value;
    await this.save(() => this.repo.setSetting(key, value));
    this.emit('settings', { key });
  }

  async loadEvent(eventId) {
    const event = await this.repo.getEvent(eventId);
    if (!event) throw new Error('Event not found');
    this.event = event;
    this.participants = await this.repo.getParticipants(eventId);
    this.byId = new Map(this.participants.map((p) => [p.id, p]));
    this.attendance = new Map();
    for (const a of await this.repo.getAttendance(event.activeSessionId)) this.attendance.set(a.participantId, a);
    this.buses = await this.repo.getBuses(eventId);
    this.seatTypes = new Map((await this.repo.getSeatTypes(eventId)).map((t) => [t.seatId, { type: t.type, label: t.label }]));
    this.setAssignmentsFromRecords(await this.repo.getAssignments(event.activeSessionId));
    this.rebuildSeatIndex();
    this.undoStack = [];
    if (this.settings.lastEventId !== eventId) await this.setSetting('lastEventId', eventId);
    this.emit('all');
  }

  async listEvents() {
    return this.repo.listEvents();
  }

  setAssignmentsFromRecords(records) {
    this.assignments = new Map();
    this.seatOf = new Map();
    for (const r of records) {
      this.assignments.set(r.seatId, r.participantId);
      this.seatOf.set(r.participantId, r.seatId);
    }
  }

  rebuildSeatIndex() {
    this.seatIndex = new Map();
    for (const bus of this.buses) {
      for (const seat of enumerateSeats(bus.id, bus.config)) this.seatIndex.set(seat.id, { seat, bus });
    }
  }

  // ── event details ─────────────────────────────────────────────────────────
  async updateEvent(fields) {
    if (!this.event) return;
    this.event = { ...this.event, ...fields };
    await this.save(() => this.repo.saveEvent(this.event));
    this.emit('event');
  }

  async deleteEvent(eventId) {
    await this.save(() => this.repo.deleteEvent(eventId));
    if (this.event?.id === eventId) {
      this.event = null;
      this.participants = [];
      this.byId = new Map();
      this.attendance = new Map();
      this.buses = [];
      this.seatTypes = new Map();
      this.setAssignmentsFromRecords([]);
      this.rebuildSeatIndex();
      const next = (await this.repo.listEvents())[0];
      if (next) await this.loadEvent(next.id);
      else await this.setSetting('lastEventId', '');
    }
    this.emit('all');
  }

  // ── import ────────────────────────────────────────────────────────────────
  /**
   * @param {object} opts
   * @param {object} opts.table   parsed table (headers, records, emptyRows)
   * @param {object} opts.mapping { name, id, keyInfo, reused }
   * @param {'new'|'replace'} opts.mode
   * @param {string} opts.fileName
   * @returns summary { count, seated, unmatchedSeats }
   */
  async importList({ table, mapping, mode, fileName }) {
    let event;
    if (mode === 'replace' && this.event) {
      event = { ...this.event };
    } else {
      const base = String(fileName || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      event = createEvent({ name: base || 'New event', defaultTemplate: this.event?.defaultTemplate });
    }
    const { participants, attendance, seatRequests, busRequests, columns } = buildParticipants(table, mapping, event.id, event.activeSessionId);
    event.columns = columns;
    event.importMeta = { fileName: fileName || '', importedAt: new Date().toISOString(), rows: participants.length };

    await this.save(async () => {
      await this.repo.saveEvent(event);
      await this.repo.replaceParticipants(event.id, participants, attendance);
    });
    await this.loadEvent(event.id);

    // Make sure there are enough buses (no confirmation needed on import:
    // a fresh import has no seat assignments yet).
    await this.recomputeBuses({ silent: true });

    // Restore seats from a previously exported file (Bus + Seat columns).
    const unmatched = [];
    const list = [];
    const used = new Set();
    for (const req of seatRequests) {
      const seatId = this.findSeatForImport(req.bus, req.seat, used);
      if (seatId) {
        used.add(seatId);
        list.push({ seatId, participantId: req.participantId });
      } else unmatched.push(req.seat);
    }
    if (list.length) {
      await this.save(() => this.repo.applyAssignments(this.sessionId, this.event.id, list));
      this.setAssignmentsFromRecords(await this.repo.getAssignments(this.sessionId));
    }
    // A Bus value without a seat (e.g. a re-imported export) restores the bus group.
    const groups = busRequests
      .map((r) => ({ r, bus: this.buses.find((b) => norm(b.name) === norm(r.bus) || norm(`bus ${b.name}`) === norm(r.bus)) }))
      .filter((x) => x.bus);
    if (groups.length) {
      const records = groups.map(({ r, bus }) => ({ ...this.getAttendance(r.participantId), busId: bus.id }));
      await this.save(() => this.repo.saveAttendanceMany(records));
      for (const rec of records) this.attendance.set(rec.participantId, rec);
    }
    this.undoStack = [];
    this.emit('all');
    return { count: participants.length, seated: list.length, unmatchedSeats: unmatched };
  }

  findSeatForImport(busName, seatLabel, used) {
    const label = String(seatLabel || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!label) return null;
    const bn = norm(busName);
    const buses = bn ? this.buses.filter((b) => norm(b.name) === bn || norm(`bus ${b.name}`) === bn) : this.buses;
    for (const bus of buses.length ? buses : this.buses) {
      for (const s of enumerateSeats(bus.id, bus.config)) {
        if (s.label.toUpperCase() === label && !used.has(s.id) && this.isAssignable(s.id, true)) return s.id;
      }
    }
    return null;
  }

  // ── attendance ────────────────────────────────────────────────────────────
  getAttendance(pid) {
    return this.attendance.get(pid) || emptyAttendance(this.sessionId, pid);
  }

  /**
   * Sets Present / Absent / null (unmarked).
   * Time stamp: set on the first status change; refreshed when an absentee
   * turns up later (absent → present = their real check-in); cleared when
   * the mark is removed.
   */
  async setStatus(pid, status, { undoable = true } = {}) {
    const prev = this.getAttendance(pid);
    const next = { ...prev, status: status || null };
    if (!next.status) {
      next.time = '';
      next.at = null;
    } else if (!prev.status || (prev.status === STATUS.ABSENT && next.status === STATUS.PRESENT)) {
      const now = new Date();
      next.time = hhmm(now);
      next.at = now.toISOString();
    }
    await this.save(() => this.repo.saveAttendance(next));
    this.attendance.set(pid, next);
    this.emit('attendance', { pid });
    if (undoable) {
      const name = this.byId.get(pid)?.name || 'participant';
      const verb = next.status ? `Marked ${name} ${next.status}` : `Cleared mark for ${name}`;
      this.pushUndo(verb, async () => {
        await this.save(() => this.repo.saveAttendance(prev));
        this.attendance.set(pid, prev);
        this.emit('attendance', { pid });
      });
    }
    return next;
  }

  async setRemarks(pid, remarks, { undoable = true } = {}) {
    const prev = this.getAttendance(pid);
    if ((prev.remarks || '') === remarks) return;
    const next = { ...prev, remarks };
    await this.save(() => this.repo.saveAttendance(next));
    this.attendance.set(pid, next);
    this.emit('attendance', { pid, field: 'remarks' });
    if (undoable) {
      this.pushUndo(`Edited remark for ${this.byId.get(pid)?.name || 'participant'}`, async () => {
        await this.save(() => this.repo.saveAttendance(prev));
        this.attendance.set(pid, prev);
        this.emit('attendance', { pid, field: 'remarks' });
      });
    }
  }

  /** Marks every unmarked participant absent (used before export). */
  async markUnmarkedAbsent() {
    const prevs = [];
    const nexts = [];
    for (const p of this.participants) {
      const a = this.getAttendance(p.id);
      if (!a.status) {
        prevs.push(a);
        nexts.push({ ...a, status: STATUS.ABSENT });
      }
    }
    if (!nexts.length) return 0;
    await this.save(() => this.repo.saveAttendanceMany(nexts));
    for (const n of nexts) this.attendance.set(n.participantId, n);
    this.emit('attendance', { bulk: true });
    this.pushUndo(`Marked ${nexts.length} unmarked as absent`, async () => {
      await this.save(() => this.repo.saveAttendanceMany(prevs));
      for (const p of prevs) this.attendance.set(p.participantId, p);
      this.emit('attendance', { bulk: true });
    });
    return nexts.length;
  }

  counts() {
    let present = 0;
    let absent = 0;
    let unseated = 0;
    for (const p of this.participants) {
      const s = this.attendance.get(p.id)?.status;
      if (s === STATUS.PRESENT) present++;
      else if (s === STATUS.ABSENT) absent++;
      if (!this.seatOf.has(p.id)) unseated++;
    }
    const total = this.participants.length;
    return { total, present, absent, unmarked: total - present - absent, unseated };
  }

  /**
   * Admin "reset all". Every part is optional; undoable.
   * @param {{attendance?: boolean, remarks?: boolean, seats?: boolean, seatTypes?: boolean}} what
   */
  async resetAll(what) {
    const prevAtt = [...this.attendance.values()].map((a) => ({ ...a }));
    const prevAssign = [...this.assignments.entries()].map(([seatId, participantId]) => ({ seatId, participantId }));
    const prevTypes = [...this.seatTypes.entries()].map(([seatId, v]) => ({ seatId, value: { ...v } }));
    await this.save(async () => {
      if (what.attendance || what.remarks) {
        const next = this.participants.map((p) => {
          const a = { ...this.getAttendance(p.id) };
          if (what.attendance) Object.assign(a, { status: null, time: '', at: null });
          if (what.remarks) a.remarks = '';
          return a;
        });
        await this.repo.saveAttendanceMany(next);
        for (const a of next) this.attendance.set(a.participantId, a);
      }
      if (what.seats) {
        await this.repo.replaceAssignments(this.sessionId, this.event.id, []);
        this.setAssignmentsFromRecords([]);
      }
      if (what.seatTypes) {
        await this.repo.setSeatTypes(this.event.id, [...this.seatTypes.keys()].map((seatId) => ({ seatId, value: null })));
        this.seatTypes = new Map();
      }
    });
    if (what.seatTypes) await this.recomputeBuses({ silent: true });
    this.emit('all');
    this.pushUndo('Reset', async () => {
      await this.save(async () => {
        await this.repo.saveAttendanceMany(prevAtt);
        await this.repo.replaceAssignments(this.sessionId, this.event.id, prevAssign);
        await this.repo.setSeatTypes(this.event.id, prevTypes);
      });
      await this.loadEvent(this.event.id);
    });
  }

  // ── buses ─────────────────────────────────────────────────────────────────
  get template() {
    return normalizeConfig(this.event?.defaultTemplate);
  }

  busStats(bus) {
    return busStats(bus, this.seatTypes, this.assignments);
  }

  capacity() {
    let total = 0;
    let usable = 0;
    let inRestricted = 0;
    for (const b of this.buses) {
      const s = this.busStats(b);
      total += s.total;
      usable += s.usable;
      inRestricted += s.seatedRestricted;
    }
    // People already sitting in a Reserved / VIP seat do not need a usable seat.
    return { total, usable, inRestricted, participants: this.participants.length, needed: Math.max(0, this.participants.length - inRestricted) };
  }

  /** Seat IDs that currently hold a passenger but would vanish under `predicate`. */
  occupiedSeatsWhere(predicate) {
    return [...this.assignments.entries()].filter(([seatId]) => predicate(seatId)).map(([seatId, pid]) => ({ seatId, pid }));
  }

  describeOccupants(list, max = 6) {
    const names = list.slice(0, max).map(({ seatId, pid }) => `${this.seatIndex.get(seatId)?.seat.label || '?'} ${this.byId.get(pid)?.name || ''}`);
    return names.join(', ') + (list.length > max ? `, +${list.length - max} more` : '');
  }

  /**
   * Auto bus count: add buses until usable seats ≥ participants, drop
   * trailing buses that are no longer needed. If dropping would unseat
   * passengers, ask first; declining keeps the bus and switches to manual.
   */
  async recomputeBuses({ silent = false } = {}) {
    if (!this.event || this.event.busMode !== 'auto') return { changed: false };
    const plan = planAutoBuses({
      buses: this.buses,
      participantCount: this.capacity().needed,
      seatTypes: this.seatTypes,
      template: this.template,
    });
    let remove = plan.remove;
    if (remove.length) {
      const ids = new Set(remove.map((b) => b.id));
      const affected = this.occupiedSeatsWhere((seatId) => ids.has(parseSeatId(seatId)?.busId));
      if (affected.length && !silent) {
        const ok = await this.confirm({
          title: `Remove bus ${remove.map((b) => b.name).join(', ')}?`,
          message: `Fewer buses are needed now, but ${affected.length} passenger(s) are seated there: ${this.describeOccupants(affected)}. Removing will unseat them.`,
          okLabel: 'Remove & unseat',
          cancelLabel: 'Keep bus (manual mode)',
          danger: true,
        });
        if (!ok) {
          await this.updateEvent({ busMode: 'manual' });
          return { changed: false, keptManual: true };
        }
      } else if (affected.length) {
        remove = []; // never silently unseat anybody
      }
    }
    if (!remove.length && !plan.addCount) return { changed: false };
    await this.save(async () => {
      for (const b of remove) await this.repo.deleteBus(b.id);
      const names = this.buses.filter((b) => !remove.includes(b)).map((b) => b.name);
      const added = [];
      let order = Math.max(-1, ...this.buses.map((b) => b.order)) + 1;
      for (let i = 0; i < plan.addCount; i++) {
        const name = nextBusName([...names, ...added.map((b) => b.name)]);
        added.push(createBus(this.event.id, name, order++, this.template));
      }
      if (added.length) await this.repo.saveBuses(added);
    });
    await this.reloadBusesAndSeats();
    if (remove.length) this.clearUndo();
    return { changed: true, added: plan.addCount, removed: remove.length };
  }

  /** Structural bus changes invalidate seat snapshots held by undo entries. */
  clearUndo() {
    this.undoStack = [];
    this.emit('undo');
  }

  async reloadBusesAndSeats() {
    this.buses = await this.repo.getBuses(this.event.id);
    this.seatTypes = new Map((await this.repo.getSeatTypes(this.event.id)).map((t) => [t.seatId, { type: t.type, label: t.label }]));
    this.setAssignmentsFromRecords(await this.repo.getAssignments(this.sessionId));
    this.rebuildSeatIndex();
    this.emit('buses');
  }

  async setBusMode(mode) {
    await this.updateEvent({ busMode: mode });
    if (mode === 'auto') await this.recomputeBuses();
    this.emit('buses');
  }

  /**
   * Applies a new layout config to a bus. Warns (and can be cancelled) if
   * seats that hold passengers would disappear.
   */
  async updateBusConfig(busId, config) {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return false;
    const next = normalizeConfig(config);
    const newIds = new Set(enumerateSeats(bus.id, next).map((s) => s.id));
    const lost = this.occupiedSeatsWhere((seatId) => parseSeatId(seatId)?.busId === busId && !newIds.has(seatId));
    if (lost.length) {
      const ok = await this.confirm({
        title: 'Seats with passengers will be removed',
        message: `${lost.length} seated passenger(s) would lose their seat: ${this.describeOccupants(lost)}. They will be moved back to "unseated".`,
        okLabel: 'Apply & unseat',
        danger: true,
      });
      if (!ok) return false;
    }
    const lostTypes = [...this.seatTypes.keys()].filter((id) => parseSeatId(id)?.busId === busId && !newIds.has(id));
    await this.save(async () => {
      for (const { seatId } of lost) await this.repo.unassignSeat(this.sessionId, seatId);
      if (lostTypes.length) await this.repo.setSeatTypes(this.event.id, lostTypes.map((seatId) => ({ seatId, value: null })));
      await this.repo.saveBus({ ...bus, config: next });
    });
    await this.reloadBusesAndSeats();
    await this.recomputeBuses();
    this.clearUndo();
    this.emit('buses');
    return true;
  }

  async renameBus(busId, name) {
    const bus = this.buses.find((b) => b.id === busId);
    const clean = String(name || '').trim().slice(0, 30);
    if (!bus || !clean) return;
    await this.save(() => this.repo.saveBus({ ...bus, name: clean }));
    await this.reloadBusesAndSeats();
  }

  async flipBus(busId) {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return;
    await this.save(() => this.repo.saveBus({ ...bus, flipped: !bus.flipped }));
    await this.reloadBusesAndSeats();
  }

  async addBus() {
    const order = Math.max(-1, ...this.buses.map((b) => b.order)) + 1;
    const bus = createBus(this.event.id, nextBusName(this.buses.map((b) => b.name)), order, this.template);
    if (this.event.busMode === 'auto') await this.updateEvent({ busMode: 'manual' });
    await this.save(() => this.repo.saveBus(bus));
    await this.reloadBusesAndSeats();
    return bus;
  }

  async removeBus(busId) {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return false;
    const affected = this.occupiedSeatsWhere((seatId) => parseSeatId(seatId)?.busId === busId);
    const ok = await this.confirm({
      title: `Remove bus ${bus.name}?`,
      message: affected.length
        ? `${affected.length} passenger(s) are seated on this bus and will be unseated: ${this.describeOccupants(affected)}.`
        : 'This bus has no passengers. Its seat types will be discarded.',
      okLabel: 'Remove bus',
      danger: true,
    });
    if (!ok) return false;
    if (this.event.busMode === 'auto') await this.updateEvent({ busMode: 'manual' });
    await this.save(() => this.repo.deleteBus(busId));
    await this.reloadBusesAndSeats();
    this.clearUndo();
    return true;
  }

  async moveBus(busId, dir) {
    const sorted = [...this.buses].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((b) => b.id === busId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    await this.save(() => this.repo.saveBuses(sorted.map((b, k) => ({ ...b, order: k }))));
    await this.reloadBusesAndSeats();
  }

  async setDefaultTemplate(config, { applyToAll = false } = {}) {
    await this.updateEvent({ defaultTemplate: normalizeConfig(config) });
    if (applyToAll) {
      for (const bus of [...this.buses]) {
        const ok = await this.updateBusConfig(bus.id, config);
        if (!ok) break;
      }
    } else {
      await this.recomputeBuses();
    }
    this.emit('buses');
  }

  // ── seat types ────────────────────────────────────────────────────────────
  seatTypeOf(seatId) {
    return this.seatTypes.get(seatId)?.type || 'available';
  }

  isAssignable(seatId, admin) {
    const t = this.seatTypeOf(seatId);
    if (t === 'unavailable') return false;
    if (t === 'reserved' || t === 'vip') return Boolean(admin);
    return true;
  }

  /** Admin only (enforced by the UI). Value: {type, label} or null for Available. */
  async setSeatTypes(seatIds, value) {
    const changes = seatIds.map((seatId) => ({ seatId, value: value && value.type !== 'available' ? value : null }));
    const prev = seatIds.map((seatId) => ({ seatId, value: this.seatTypes.get(seatId) || null }));
    // Unavailable seats cannot hold anyone: unseat them (after confirming).
    let unseat = [];
    if (value?.type === 'unavailable') {
      unseat = seatIds.filter((id) => this.assignments.has(id)).map((seatId) => ({ seatId, pid: this.assignments.get(seatId) }));
      if (unseat.length) {
        const ok = await this.confirm({
          title: 'Unseat passenger?',
          message: `${this.describeOccupants(unseat)} — an unavailable seat cannot be used. Unseat and continue?`,
          okLabel: 'Unseat & mark unavailable',
          danger: true,
        });
        if (!ok) return false;
      }
    }
    await this.save(async () => {
      for (const { seatId } of unseat) await this.repo.unassignSeat(this.sessionId, seatId);
      await this.repo.setSeatTypes(this.event.id, changes);
    });
    for (const c of changes) {
      if (c.value) this.seatTypes.set(c.seatId, { type: c.value.type, label: c.value.label || '' });
      else this.seatTypes.delete(c.seatId);
    }
    for (const { seatId, pid } of unseat) {
      this.assignments.delete(seatId);
      this.seatOf.delete(pid);
    }
    this.emit('seatTypes');
    this.pushUndo('Changed seat type', async () => {
      await this.save(() => this.repo.setSeatTypes(this.event.id, prev));
      for (const p of prev) {
        if (p.value) this.seatTypes.set(p.seatId, p.value);
        else this.seatTypes.delete(p.seatId);
      }
      this.emit('seatTypes');
      await this.recomputeBuses();
    });
    await this.recomputeBuses();
    return true;
  }

  // ── seat assignment ───────────────────────────────────────────────────────
  snapshotAssignments() {
    return [...this.assignments.entries()].map(([seatId, participantId]) => ({ seatId, participantId }));
  }

  async restoreAssignments(snapshot) {
    const list = snapshot.filter((a) => this.seatIndex.has(a.seatId) && this.byId.has(a.participantId));
    await this.save(() => this.repo.replaceAssignments(this.sessionId, this.event.id, list));
    this.setAssignmentsFromRecords(list);
    this.emit('assignments');
  }

  async assignSeat(seatId, pid, { admin = false } = {}) {
    if (!this.seatIndex.has(seatId)) throw new Error('Unknown seat');
    if (!this.isAssignable(seatId, admin)) {
      const t = this.seatTypeOf(seatId);
      throw new Error(t === 'unavailable' ? 'That seat is unavailable.' : `That seat is ${t === 'vip' ? 'VIP' : 'reserved'} — admin only.`);
    }
    const before = this.snapshotAssignments();
    try {
      await this.save(() => this.repo.assignSeat(this.sessionId, this.event.id, seatId, pid));
    } catch (e) {
      if (e instanceof SeatTakenError || e?.name === 'SeatTakenError') throw new Error('That seat is already taken.');
      throw e;
    }
    const old = this.seatOf.get(pid);
    if (old) this.assignments.delete(old);
    this.assignments.set(seatId, pid);
    this.seatOf.set(pid, seatId);
    this.emit('assignments', { seatId, pid });
    const label = this.seatIndex.get(seatId).seat.label;
    this.pushUndo(`${old ? 'Moved' : 'Seated'} ${this.byId.get(pid)?.name} → ${label}`, () => this.restoreAssignments(before));
    await this.afterRestrictedChange([seatId, old]);
  }

  /**
   * Someone moving into / out of a Reserved or VIP seat changes how many
   * usable seats are still needed, so the auto bus count may change.
   */
  async afterRestrictedChange(seatIds) {
    const restricted = seatIds.filter(Boolean).some((id) => ['reserved', 'vip'].includes(this.seatTypeOf(id)));
    if (restricted) await this.recomputeBuses();
  }

  async unassignSeat(seatId) {
    const pid = this.assignments.get(seatId);
    if (!pid) return;
    const before = this.snapshotAssignments();
    await this.save(() => this.repo.unassignSeat(this.sessionId, seatId));
    this.assignments.delete(seatId);
    this.seatOf.delete(pid);
    this.emit('assignments', { seatId, pid });
    this.pushUndo(`Unseated ${this.byId.get(pid)?.name}`, () => this.restoreAssignments(before));
    await this.afterRestrictedChange([seatId]);
  }

  async swapSeats(seatA, seatB, { admin = false } = {}) {
    const a = this.assignments.get(seatA);
    const b = this.assignments.get(seatB);
    if (a && !this.isAssignable(seatB, admin)) throw new Error('Target seat is restricted (admin only).');
    if (b && !this.isAssignable(seatA, admin)) throw new Error('Source seat is restricted (admin only).');
    const before = this.snapshotAssignments();
    await this.save(() => this.repo.swapSeats(this.sessionId, seatA, seatB));
    this.assignments.delete(seatA);
    this.assignments.delete(seatB);
    if (a) {
      this.assignments.set(seatB, a);
      this.seatOf.set(a, seatB);
    }
    if (b) {
      this.assignments.set(seatA, b);
      this.seatOf.set(b, seatA);
    }
    this.emit('assignments');
    const n = (pid) => this.byId.get(pid)?.name || '';
    this.pushUndo(`Swapped ${n(a)} ⇄ ${n(b)}`, () => this.restoreAssignments(before));
    await this.afterRestrictedChange([seatA, seatB]);
  }

  /** Seats in fill order: bus order, lower deck first, front to back, left to right. */
  orderedSeats() {
    const out = [];
    for (const bus of [...this.buses].sort((a, b) => a.order - b.order)) {
      for (const seat of enumerateSeats(bus.id, bus.config)) out.push({ seat, bus });
    }
    return out;
  }

  /**
   * Auto-fill: seats unseated participants in list order into free Available
   * seats. Never moves anybody already seated.
   */
  planAutoFill({ skipAbsent = true } = {}) {
    const people = this.participants.filter(
      (p) => !this.seatOf.has(p.id) && !(skipAbsent && this.attendance.get(p.id)?.status === STATUS.ABSENT),
    );
    const free = this.orderedSeats().filter(({ seat }) => !this.assignments.has(seat.id) && this.seatTypeOf(seat.id) === 'available');
    const used = new Set();
    const take = (pred) => {
      const hit = free.find((f) => !used.has(f.seat.id) && pred(f));
      if (hit) used.add(hit.seat.id);
      return hit;
    };
    const list = [];
    let busFull = 0;
    // 1) People with a bus group only go to seats on their bus.
    for (const p of people) {
      const busId = this.allocatedBusOf(p.id);
      if (!busId) continue;
      const hit = take((f) => f.bus.id === busId);
      if (hit) list.push({ seatId: hit.seat.id, participantId: p.id });
      else busFull++;
    }
    // 2) Everyone else fills the remaining seats, front to back.
    for (const p of people) {
      if (this.allocatedBusOf(p.id)) continue;
      const hit = take(() => true);
      if (hit) list.push({ seatId: hit.seat.id, participantId: p.id });
    }
    return { list, waiting: people.length, freeSeats: free.length, leftover: people.length - list.length, busFull };
  }

  // ── bus groups ────────────────────────────────────────────────────────────
  // Which bus a person takes, decided before (or without) a seat. Stored on
  // the person's attendance record for the session (`busId`). A seat always
  // wins: once seated, the seat's bus is the person's bus.

  busName(busId) {
    return this.buses.find((b) => b.id === busId)?.name || '';
  }

  allocatedBusOf(pid) {
    const id = this.attendance.get(pid)?.busId;
    return id && this.buses.some((b) => b.id === id) ? id : '';
  }

  /** Seat's bus if seated, otherwise the bus group ('' = none). */
  busOf(pid) {
    const seatId = this.seatOf.get(pid);
    return seatId ? this.seatIndex.get(seatId)?.bus.id || '' : this.allocatedBusOf(pid);
  }

  /** Free usable seats left on a bus once its seated people and its group are counted. */
  busRoomLeft(busId, { ignore = new Set() } = {}) {
    const bus = this.buses.find((b) => b.id === busId);
    if (!bus) return 0;
    const s = this.busStats(bus);
    let grouped = 0;
    for (const p of this.participants) {
      if (!ignore.has(p.id) && !this.seatOf.has(p.id) && this.allocatedBusOf(p.id) === busId) grouped++;
    }
    return s.usable - s.seated - grouped;
  }

  /** Puts people in a bus group ('' = no bus). Undoable. */
  async setBusGroup(pids, busId, label) {
    const prevs = pids.map((pid) => ({ ...this.getAttendance(pid) }));
    const nexts = prevs.map((a) => ({ ...a, busId: busId || '' }));
    await this.saveGroupRecords(nexts);
    this.pushUndo(label || (busId ? `Put ${pids.length} on bus ${this.busName(busId)}` : `Cleared the bus for ${pids.length}`), () => this.saveGroupRecords(prevs));
  }

  async saveGroupRecords(records) {
    await this.save(() => this.repo.saveAttendanceMany(records));
    for (const r of records) this.attendance.set(r.participantId, r);
    this.emit('allocations', { pids: records.map((r) => r.participantId) });
  }

  /**
   * Random bus groups, balanced so every bus ends up with about the same
   * number of free seats. People who already have a seat keep their bus.
   * @returns {{ plan: Map<string, string[]>, overflow: number }}
   */
  planRandomGroups(pids) {
    const people = pids.filter((pid) => !this.seatOf.has(pid));
    const ignore = new Set(people);
    const buses = [...this.buses].sort((a, b) => a.order - b.order);
    const room = new Map(buses.map((b) => [b.id, this.busRoomLeft(b.id, { ignore })]));
    // Fisher–Yates shuffle with the platform's crypto RNG.
    const order = [...people];
    const rnd = new Uint32Array(order.length);
    crypto.getRandomValues(rnd);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rnd[i] % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    const plan = new Map(buses.map((b) => [b.id, []]));
    let overflow = 0;
    for (const pid of order) {
      // The bus with the most room left (ties → earlier bus).
      let best = buses[0];
      for (const b of buses) if (room.get(b.id) > room.get(best.id)) best = b;
      if (room.get(best.id) <= 0) overflow++;
      room.set(best.id, room.get(best.id) - 1);
      plan.get(best.id).push(pid);
    }
    return { plan, overflow };
  }

  async randomBusGroups(pids) {
    if (!this.buses.length) return { plan: new Map(), overflow: 0, count: 0 };
    const { plan, overflow } = this.planRandomGroups(pids);
    const records = [];
    const prevs = [];
    for (const [busId, list] of plan) {
      for (const pid of list) {
        const a = this.getAttendance(pid);
        prevs.push({ ...a });
        records.push({ ...a, busId });
      }
    }
    if (!records.length) return { plan, overflow, count: 0 };
    await this.saveGroupRecords(records);
    this.pushUndo(`Randomly grouped ${records.length} people`, () => this.saveGroupRecords(prevs));
    return { plan, overflow, count: records.length };
  }

  async autoFill(opts) {
    const plan = this.planAutoFill(opts);
    if (!plan.list.length) return plan;
    const before = this.snapshotAssignments();
    await this.save(() => this.repo.applyAssignments(this.sessionId, this.event.id, plan.list));
    for (const { seatId, participantId } of plan.list) {
      this.assignments.set(seatId, participantId);
      this.seatOf.set(participantId, seatId);
    }
    this.emit('assignments');
    this.pushUndo(`Auto-filled ${plan.list.length} seats`, () => this.restoreAssignments(before));
    return plan;
  }

  seatLabelOf(pid) {
    const seatId = this.seatOf.get(pid);
    if (!seatId) return null;
    const info = this.seatIndex.get(seatId);
    return info ? { seatId, label: info.seat.label, bus: info.bus.name, busId: info.bus.id, order: info.bus.order * 10000 + info.seat.index } : null;
  }

  // ── phone numbers ─────────────────────────────────────────────────────────
  /**
   * The column holding phone numbers ('' = none). Events imported before the
   * phone mapping existed fall back to a guess from their headers.
   */
  phoneColumn() {
    const cols = this.event?.columns;
    if (!cols) return '';
    if (typeof cols.phone === 'string') return cols.phone;
    return guessPhoneColumn(cols.headers || [], [cols.name, cols.id, ...Object.values(cols.reused || {})].filter(Boolean));
  }

  phoneOf(p) {
    const col = this.phoneColumn();
    return col ? String(p?.original?.[col] ?? '').trim() : '';
  }

  async setPhoneColumn(col) {
    if (!this.event?.columns) return;
    await this.updateEvent({ columns: { ...this.event.columns, phone: col || '' } });
  }

  // ── backup ────────────────────────────────────────────────────────────────
  async exportBackup() {
    return this.repo.exportEvent(this.event.id);
  }

  validateBackup(snap) {
    if (!snap || snap.format !== BACKUP_FORMAT) throw new Error('This file is not an Attendance PIC backup.');
    if (Number(snap.schemaVersion) > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of the app. Update the app first.');
    for (const k of ['event', 'participants', 'buses', 'seatTypes', 'sessions']) {
      if (!snap[k]) throw new Error(`Backup is missing "${k}".`);
    }
    return {
      name: snap.event.name,
      participants: snap.participants.length,
      buses: snap.buses.length,
      exportedAt: snap.exportedAt,
    };
  }

  async restoreBackup(snap) {
    this.validateBackup(snap);
    await this.save(() => this.repo.importEvent(snap));
    await this.loadEvent(snap.event.id);
  }

  async eraseEverything() {
    await this.repo.eraseAll();
  }
}

export const store = new Store();
