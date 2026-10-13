// Data model factories. Every persisted object is plain JSON with a stable ID.
//
//   Event        { id, name, date, venue, picName, sessions[], activeSessionId,
//                  columns, defaultTemplate, busMode, createdAt, updatedAt, schemaVersion }
//   Session      { id, name }                       — one per trip leg / day (UI: one for now)
//   Participant  { id, eventId, order, name, studentId, original{}, extra{} }
//   Attendance   { sessionId, participantId, status, time, at, remarks }
//   Bus          { id, eventId, name, order, flipped, config }
//   SeatType     { eventId, seatId, busId, type, label }   — type: unavailable | reserved | vip
//   Assignment   { sessionId, seatId, participantId, eventId, busId, assignedAt }

import { newId } from '../utils/ids.js';
import { isoDate } from '../utils/format.js';
import { DEFAULT_TEMPLATE, normalizeConfig } from './layout.js';

export const SCHEMA_VERSION = 1;

export const STATUS = Object.freeze({ PRESENT: 'present', ABSENT: 'absent' });
export const SEAT_TYPES = Object.freeze(['unavailable', 'reserved', 'vip']);
export const SEAT_TYPE_NAMES = { available: 'Available', unavailable: 'Unavailable', reserved: 'Reserved', vip: 'VIP' };

export function createSession(name = 'Main') {
  return { id: newId('ses'), name };
}

export function createEvent(fields = {}) {
  const session = createSession();
  const now = new Date().toISOString();
  return {
    id: newId('evt'),
    name: fields.name || 'Untitled event',
    date: fields.date ?? isoDate(),
    venue: fields.venue || '',
    picName: fields.picName || '',
    sessions: [session],
    activeSessionId: session.id,
    columns: null,
    defaultTemplate: normalizeConfig(fields.defaultTemplate || DEFAULT_TEMPLATE),
    busMode: 'auto', // 'auto' = bus count follows participant count; 'manual' = admin decides
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
  };
}

export function createBus(eventId, name, order, template) {
  return { id: newId('bus'), eventId, name, order, flipped: false, config: normalizeConfig(template || DEFAULT_TEMPLATE) };
}

export function emptyAttendance(sessionId, participantId) {
  return { sessionId, participantId, status: null, time: '', at: null, remarks: '' };
}
