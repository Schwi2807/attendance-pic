// Phase 1 repository: IndexedDB, entirely on this device.
// See repository.js for the contract. Nothing here ever touches the network.

import { SeatTakenError, BACKUP_FORMAT } from './errors.js';
import { SCHEMA_VERSION } from '../domain/model.js';

const DB_NAME = 'attendance-pic';
const DB_VERSION = 1;

const S = {
  events: 'events',
  participants: 'participants',
  attendance: 'attendance',
  buses: 'buses',
  seatTypes: 'seatTypes',
  assignments: 'assignments',
  settings: 'settings',
};

const reqP = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

function openDb() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(S.events)) db.createObjectStore(S.events, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(S.participants)) {
        db.createObjectStore(S.participants, { keyPath: 'id' }).createIndex('eventId', 'eventId');
      }
      if (!db.objectStoreNames.contains(S.attendance)) {
        db.createObjectStore(S.attendance, { keyPath: ['sessionId', 'participantId'] }).createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains(S.buses)) {
        db.createObjectStore(S.buses, { keyPath: 'id' }).createIndex('eventId', 'eventId');
      }
      if (!db.objectStoreNames.contains(S.seatTypes)) {
        const st = db.createObjectStore(S.seatTypes, { keyPath: ['eventId', 'seatId'] });
        st.createIndex('eventId', 'eventId');
        st.createIndex('busId', 'busId');
      }
      if (!db.objectStoreNames.contains(S.assignments)) {
        const as = db.createObjectStore(S.assignments, { keyPath: ['sessionId', 'seatId'] });
        as.createIndex('sessionId', 'sessionId');
        as.createIndex('eventId', 'eventId');
        as.createIndex('busId', 'busId');
        // One seat per participant per session — enforced by the database,
        // mirroring the unique constraint a Phase 2 server would use.
        as.createIndex('sessionParticipant', ['sessionId', 'participantId'], { unique: true });
      }
      if (!db.objectStoreNames.contains(S.settings)) db.createObjectStore(S.settings, { keyPath: 'key' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('Database is open in another tab. Close other tabs and reload.'));
  });
}

const busIdOf = (seatId) => String(seatId).split('.')[0];

export class IndexedDbRepository {
  async init() {
    this.db = await openDb();
    this.db.onversionchange = () => this.db.close();
  }

  /** Runs `body(tx)` inside one transaction; resolves after commit. */
  async run(stores, mode, body) {
    const tx = this.db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
    });
    let result;
    try {
      result = await body(tx);
    } catch (err) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      await done.catch(() => {});
      throw err;
    }
    await done;
    return result;
  }

  getAllByIndex(tx, store, index, key) {
    return reqP(tx.objectStore(store).index(index).getAll(key));
  }

  async deleteByIndex(tx, store, index, key) {
    const keys = await reqP(tx.objectStore(store).index(index).getAllKeys(key));
    for (const k of keys) tx.objectStore(store).delete(k);
    return keys.length;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  async listEvents() {
    const all = await this.run([S.events], 'readonly', (tx) => reqP(tx.objectStore(S.events).getAll()));
    return all
      .map(({ id, name, date, venue, updatedAt, createdAt }) => ({ id, name, date, venue, updatedAt, createdAt }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getEvent(eventId) {
    return this.run([S.events], 'readonly', (tx) => reqP(tx.objectStore(S.events).get(eventId))).then((e) => e || null);
  }

  saveEvent(event) {
    return this.run([S.events], 'readwrite', (tx) => {
      tx.objectStore(S.events).put({ ...event, updatedAt: new Date().toISOString() });
    });
  }

  deleteEvent(eventId) {
    return this.run(Object.values(S).filter((s) => s !== S.settings), 'readwrite', async (tx) => {
      const event = await reqP(tx.objectStore(S.events).get(eventId));
      if (!event) return;
      for (const ses of event.sessions || []) {
        await this.deleteByIndex(tx, S.attendance, 'sessionId', ses.id);
        await this.deleteByIndex(tx, S.assignments, 'sessionId', ses.id);
      }
      await this.deleteByIndex(tx, S.participants, 'eventId', eventId);
      await this.deleteByIndex(tx, S.buses, 'eventId', eventId);
      await this.deleteByIndex(tx, S.seatTypes, 'eventId', eventId);
      tx.objectStore(S.events).delete(eventId);
    });
  }

  // ── Participants ─────────────────────────────────────────────────────────
  async getParticipants(eventId) {
    const list = await this.run([S.participants], 'readonly', (tx) => this.getAllByIndex(tx, S.participants, 'eventId', eventId));
    return list.sort((a, b) => a.order - b.order);
  }

  saveParticipant(p) {
    return this.run([S.participants], 'readwrite', (tx) => {
      tx.objectStore(S.participants).put(p);
    });
  }

  replaceParticipants(eventId, participants, attendance = []) {
    return this.run([S.events, S.participants, S.attendance, S.assignments], 'readwrite', async (tx) => {
      const event = await reqP(tx.objectStore(S.events).get(eventId));
      await this.deleteByIndex(tx, S.participants, 'eventId', eventId);
      for (const ses of event?.sessions || []) {
        await this.deleteByIndex(tx, S.attendance, 'sessionId', ses.id);
        await this.deleteByIndex(tx, S.assignments, 'sessionId', ses.id);
      }
      const ps = tx.objectStore(S.participants);
      for (const p of participants) ps.put(p);
      const as = tx.objectStore(S.attendance);
      for (const a of attendance) as.put(a);
    });
  }

  // ── Attendance ───────────────────────────────────────────────────────────
  getAttendance(sessionId) {
    return this.run([S.attendance], 'readonly', (tx) => this.getAllByIndex(tx, S.attendance, 'sessionId', sessionId));
  }

  saveAttendance(record) {
    return this.run([S.attendance], 'readwrite', (tx) => {
      tx.objectStore(S.attendance).put(record);
    });
  }

  saveAttendanceMany(records) {
    return this.run([S.attendance], 'readwrite', (tx) => {
      const st = tx.objectStore(S.attendance);
      for (const r of records) st.put(r);
    });
  }

  // ── Buses ────────────────────────────────────────────────────────────────
  async getBuses(eventId) {
    const list = await this.run([S.buses], 'readonly', (tx) => this.getAllByIndex(tx, S.buses, 'eventId', eventId));
    return list.sort((a, b) => a.order - b.order);
  }

  saveBus(bus) {
    return this.saveBuses([bus]);
  }

  saveBuses(buses) {
    return this.run([S.buses], 'readwrite', (tx) => {
      const st = tx.objectStore(S.buses);
      for (const b of buses) st.put(b);
    });
  }

  deleteBus(busId) {
    return this.run([S.buses, S.seatTypes, S.assignments], 'readwrite', async (tx) => {
      await this.deleteByIndex(tx, S.seatTypes, 'busId', busId);
      await this.deleteByIndex(tx, S.assignments, 'busId', busId);
      tx.objectStore(S.buses).delete(busId);
    });
  }

  // ── Seat types ───────────────────────────────────────────────────────────
  getSeatTypes(eventId) {
    return this.run([S.seatTypes], 'readonly', (tx) => this.getAllByIndex(tx, S.seatTypes, 'eventId', eventId));
  }

  setSeatType(eventId, seatId, value) {
    return this.setSeatTypes(eventId, [{ seatId, value }]);
  }

  /** Bulk version: [{seatId, value: {type,label} | null}] in one transaction. */
  setSeatTypes(eventId, changes) {
    return this.run([S.seatTypes], 'readwrite', (tx) => {
      const st = tx.objectStore(S.seatTypes);
      for (const { seatId, value } of changes) {
        if (!value || !value.type || value.type === 'available') st.delete([eventId, seatId]);
        else st.put({ eventId, seatId, busId: busIdOf(seatId), type: value.type, label: value.label || '' });
      }
    });
  }

  // ── Assignments ──────────────────────────────────────────────────────────
  getAssignments(sessionId) {
    return this.run([S.assignments], 'readonly', (tx) => this.getAllByIndex(tx, S.assignments, 'sessionId', sessionId));
  }

  assignSeat(sessionId, eventId, seatId, participantId) {
    return this.run([S.assignments], 'readwrite', async (tx) => {
      const st = tx.objectStore(S.assignments);
      const existing = await reqP(st.get([sessionId, seatId]));
      if (existing && existing.participantId !== participantId) throw new SeatTakenError(seatId, existing.participantId);
      const prev = await reqP(st.index('sessionParticipant').get([sessionId, participantId]));
      if (prev) st.delete([sessionId, prev.seatId]);
      st.put({ sessionId, seatId, participantId, eventId, busId: busIdOf(seatId), assignedAt: new Date().toISOString() });
    });
  }

  unassignSeat(sessionId, seatId) {
    return this.run([S.assignments], 'readwrite', (tx) => {
      tx.objectStore(S.assignments).delete([sessionId, seatId]);
    });
  }

  swapSeats(sessionId, seatA, seatB) {
    return this.run([S.assignments], 'readwrite', async (tx) => {
      const st = tx.objectStore(S.assignments);
      const a = await reqP(st.get([sessionId, seatA]));
      const b = await reqP(st.get([sessionId, seatB]));
      // Delete both first so the unique participant index never sees a duplicate.
      st.delete([sessionId, seatA]);
      st.delete([sessionId, seatB]);
      const now = new Date().toISOString();
      if (a) st.put({ ...a, seatId: seatB, busId: busIdOf(seatB), assignedAt: now });
      if (b) st.put({ ...b, seatId: seatA, busId: busIdOf(seatA), assignedAt: now });
    });
  }

  applyAssignments(sessionId, eventId, list) {
    return this.run([S.assignments], 'readwrite', async (tx) => {
      const st = tx.objectStore(S.assignments);
      const now = new Date().toISOString();
      for (const { seatId, participantId } of list) {
        const existing = await reqP(st.get([sessionId, seatId]));
        if (existing && existing.participantId !== participantId) throw new SeatTakenError(seatId, existing.participantId);
        st.put({ sessionId, seatId, participantId, eventId, busId: busIdOf(seatId), assignedAt: now });
      }
    });
  }

  replaceAssignments(sessionId, eventId, list) {
    return this.run([S.assignments], 'readwrite', async (tx) => {
      await this.deleteByIndex(tx, S.assignments, 'sessionId', sessionId);
      const st = tx.objectStore(S.assignments);
      const now = new Date().toISOString();
      for (const { seatId, participantId, assignedAt } of list) {
        st.put({ sessionId, seatId, participantId, eventId, busId: busIdOf(seatId), assignedAt: assignedAt || now });
      }
    });
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async getSetting(key) {
    const row = await this.run([S.settings], 'readonly', (tx) => reqP(tx.objectStore(S.settings).get(key)));
    return row ? row.value : undefined;
  }

  setSetting(key, value) {
    return this.run([S.settings], 'readwrite', (tx) => {
      tx.objectStore(S.settings).put({ key, value });
    });
  }

  /** Wipes every store (used by "Forgot PIN → erase this device"). */
  eraseAll() {
    return this.run(Object.values(S), 'readwrite', (tx) => {
      for (const s of Object.values(S)) tx.objectStore(s).clear();
    });
  }

  // ── Backup ───────────────────────────────────────────────────────────────
  exportEvent(eventId) {
    return this.run(Object.values(S).filter((s) => s !== S.settings), 'readonly', async (tx) => {
      const event = await reqP(tx.objectStore(S.events).get(eventId));
      if (!event) throw new Error('Event not found');
      const sessions = [];
      for (const ses of event.sessions || []) {
        sessions.push({
          id: ses.id,
          attendance: await this.getAllByIndex(tx, S.attendance, 'sessionId', ses.id),
          assignments: await this.getAllByIndex(tx, S.assignments, 'sessionId', ses.id),
        });
      }
      return {
        format: BACKUP_FORMAT,
        schemaVersion: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        event,
        participants: (await this.getAllByIndex(tx, S.participants, 'eventId', eventId)).sort((a, b) => a.order - b.order),
        buses: (await this.getAllByIndex(tx, S.buses, 'eventId', eventId)).sort((a, b) => a.order - b.order),
        seatTypes: await this.getAllByIndex(tx, S.seatTypes, 'eventId', eventId),
        sessions,
      };
    });
  }

  importEvent(snap) {
    return this.run(Object.values(S).filter((s) => s !== S.settings), 'readwrite', async (tx) => {
      const id = snap.event.id;
      const old = await reqP(tx.objectStore(S.events).get(id));
      const sessionIds = new Set([...(old?.sessions || []), ...(snap.event.sessions || [])].map((s) => s.id));
      for (const sid of sessionIds) {
        await this.deleteByIndex(tx, S.attendance, 'sessionId', sid);
        await this.deleteByIndex(tx, S.assignments, 'sessionId', sid);
      }
      await this.deleteByIndex(tx, S.participants, 'eventId', id);
      await this.deleteByIndex(tx, S.buses, 'eventId', id);
      await this.deleteByIndex(tx, S.seatTypes, 'eventId', id);
      tx.objectStore(S.events).put({ ...snap.event, updatedAt: new Date().toISOString() });
      for (const p of snap.participants) tx.objectStore(S.participants).put(p);
      for (const b of snap.buses) tx.objectStore(S.buses).put(b);
      for (const t of snap.seatTypes) tx.objectStore(S.seatTypes).put(t);
      for (const ses of snap.sessions) {
        for (const a of ses.attendance) tx.objectStore(S.attendance).put(a);
        for (const a of ses.assignments) tx.objectStore(S.assignments).put(a);
      }
    });
  }
}
