// ─────────────────────────────────────────────────────────────────────────────
// Storage repository — the ONLY way the app reads or writes data.
//
// The UI and the store never touch IndexedDB (or, in Phase 2, the network)
// directly. Swapping the backend means writing another class with the same
// async methods and returning it from `createRepository()`.
//
// Contract (all methods return Promises, all values are plain JSON):
//
//   init()
//   ── Events ────────────────────────────────────────────────────────────────
//   listEvents()                         → EventSummary[] (newest first)
//   getEvent(eventId)                    → Event | null
//   saveEvent(event)
//   deleteEvent(eventId)                 cascades to everything below
//   ── Participants ──────────────────────────────────────────────────────────
//   getParticipants(eventId)             → Participant[] (by `order`)
//   saveParticipant(participant)
//   replaceParticipants(eventId, list, attendance[])
//                                        replaces the list; clears attendance
//                                        and seat assignments of the event
//   ── Attendance (per session) ──────────────────────────────────────────────
//   getAttendance(sessionId)             → AttendanceRecord[]
//   saveAttendance(record)
//   saveAttendanceMany(records)
//   ── Buses ─────────────────────────────────────────────────────────────────
//   getBuses(eventId)                    → Bus[] (by `order`)
//   saveBus(bus) / saveBuses(buses)
//   deleteBus(busId)                     also drops its seat types + assignments
//   ── Seat types (per event) ────────────────────────────────────────────────
//   getSeatTypes(eventId)                → SeatType[]
//   setSeatType(eventId, seatId, {type, label} | null)
//   ── Seat assignments (per session) ────────────────────────────────────────
//   getAssignments(sessionId)            → Assignment[]
//   assignSeat(sessionId, eventId, seatId, participantId)
//                                        atomic; frees the participant's old
//                                        seat; throws SeatTakenError if the
//                                        seat belongs to someone else
//   unassignSeat(sessionId, seatId)
//   swapSeats(sessionId, seatIdA, seatIdB)
//   applyAssignments(sessionId, eventId, [{seatId, participantId}])  atomic bulk add
//   replaceAssignments(sessionId, eventId, [{seatId, participantId}]) atomic replace
//   ── Device settings ───────────────────────────────────────────────────────
//   getSetting(key) / setSetting(key, value)
//   ── Backup ────────────────────────────────────────────────────────────────
//   exportEvent(eventId)                 → snapshot (see BACKUP_FORMAT)
//   importEvent(snapshot)                replaces an event with the same id
//
// Phase 2 note: a remote implementation maps these 1:1 onto tables with
// unique constraints on (session_id, seat_id) and (session_id, participant_id),
// which is what makes double-booking impossible server-side.
// ─────────────────────────────────────────────────────────────────────────────

import { IndexedDbRepository } from './indexeddb.js';

export { SeatTakenError, BACKUP_FORMAT } from './errors.js';

export async function createRepository() {
  const repo = new IndexedDbRepository();
  await repo.init();
  return repo;
}
