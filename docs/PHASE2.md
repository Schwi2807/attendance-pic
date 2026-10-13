# Phase 2 — online self-reservation (NOT built)

Goal: students log in with their student ID (e.g. `AD250001`) and reserve their own seat. Everyone else
sees taken seats masked as `AD••••••`. The PIC keeps using the iPad app for attendance. Likely stack:
**Supabase** (Auth, Postgres, Realtime, Row-Level Security).

Phase 1 was built so this can be added without rewriting the app. These are the hooks.

## 1. Swappable storage repository

All reads and writes go through one interface — `app/js/repo/repository.js` documents the contract;
`app/js/repo/indexeddb.js` is the Phase 1 implementation. The store (`app/js/store.js`) and the UI never
touch IndexedDB.

Phase 2 adds e.g. `app/js/repo/supabase.js` with the **same async methods** and picks it in
`createRepository()` (for example when the event is "online"). Methods map 1:1 to tables:

| Repository method | Phase 2 (Supabase) |
|---|---|
| `getEvent / saveEvent / listEvents / deleteEvent` | `events` table |
| `getParticipants / saveParticipant / replaceParticipants` | `participants` |
| `getAttendance / saveAttendance / saveAttendanceMany` | `attendance` (PIC only) |
| `getBuses / saveBus / saveBuses / deleteBus` | `buses` (config stored as `jsonb`) |
| `getSeatTypes / setSeatType / setSeatTypes` | `seat_types` |
| `getAssignments / assignSeat / unassignSeat / swapSeats / applyAssignments / replaceAssignments` | `seat_assignments` + RPCs |
| `exportEvent / importEvent` | RPC that reads/writes all of the above in one transaction |

`assignSeat` already has the server semantics: it is atomic, frees the participant's previous seat and
throws `SeatTakenError` when somebody else holds the seat — exactly what a unique-constraint violation
(`23505`) from Postgres would be translated into.

## 2. Stable, globally unique seat IDs

- Seat ID format: `"<busId>.<deck>.<row><letter>"`, e.g. `bus_3f9c0a1b2c3d4e5f.L.3C`.
- `busId` is random (`bus_` + 16 hex chars), so a seat ID is unique within an event (and in practice
  globally). Single-deck buses use deck `L` internally, so turning a bus into a double-decker keeps IDs.
- Seats are **derived** from the bus config (`enumerateSeats()` in `app/js/domain/layout.js`); the server can
  run the same function (it is pure JS with no DOM) or store the generated seat list.

Suggested constraints (one booking per seat and one seat per person, per session):

```sql
create table seat_assignments (
  session_id     text not null references sessions(id) on delete cascade,
  seat_id        text not null,
  participant_id text not null references participants(id) on delete cascade,
  event_id       text not null references events(id) on delete cascade,
  bus_id         text not null references buses(id) on delete cascade,
  assigned_at    timestamptz not null default now(),
  assigned_by    uuid references auth.users(id),
  primary key (session_id, seat_id),          -- no double booking
  unique (session_id, participant_id)         -- one seat per student
);
```

The IndexedDB schema already mirrors this: primary key `[sessionId, seatId]` plus a **unique** index
`[sessionId, participantId]`.

## 3. Sessions

Attendance and seat assignments are keyed by `sessionId`; buses and seat types by `eventId`. An event has
`sessions[]` and an `activeSessionId` (the UI shows one session today). Phase 2 can open reservation per
session (e.g. *Outbound* and *Return*) without data migration.

## 4. One masking function

`app/js/utils/mask.js` → `maskId('AD250001') === 'AD••••••'` is the **only** place that decides the masked
format (used today by the *Mask IDs on screen* setting). In Phase 2 the same rule moves server-side —
a view or RPC returns masked IDs to students, so full IDs never reach other students' browsers:

```sql
-- Same rule as maskId() in app/js/utils/mask.js
create or replace function mask_id(id text) returns text language plpgsql immutable as $$
declare
  s      text := btrim(coalesce(id, ''));
  prefix text := coalesce(substring(s from '^[A-Za-z]{1,3}'), '');
  keep   int  := case when length(prefix) > 0 then length(prefix)
                      else least(2, greatest(0, length(s) - 4)) end;
begin
  if s = '' then return ''; end if;
  return left(s, keep) || repeat('•', greatest(length(s) - keep, 1));
end $$;
```

Keep both implementations in sync (there is a test-friendly pure function on each side).

## 5. Seat types & admin rules

Seat types (`unavailable`, `reserved`, `vip` + label) live in `seat_types (event_id, seat_id, type, label)`.
Rules already enforced in `store.isAssignable()`:

- `unavailable` → nobody;
- `reserved` / `vip` → admin (PIC) only;
- everything else → anybody (in Phase 2: the student themself, during an open reservation window).

Row-Level Security sketch:

| Table | Student (authenticated, `auth.jwt() ->> 'student_id'`) | PIC / admin |
|---|---|---|
| `participants` | read own row only | all |
| `seat_assignments` | read all **through a masked view**; insert/delete only where `participant_id` = own and seat type is `available` | all |
| `attendance` | none | all |
| `seat_types`, `buses`, `events` | read | all |

## 6. Realtime

The store already re-renders from `change` events (`store.emit('assignments')`). A Supabase Realtime
subscription on `seat_assignments` filtered by `session_id` only needs to update `store.assignments` /
`store.seatOf` and emit the same event — the seat maps update live.

## 7. Offline + online together

Keep Phase 1's IndexedDB as a local cache/outbox for the PIC iPad: write locally first, sync when online,
and resolve conflicts on the server with the unique constraints above (server wins; the PIC sees a toast
"Seat 3C was taken online by AD••••••").

## 8. Privacy checklist for Phase 2

- Update the CSP `connect-src` to `'self' https://<project>.supabase.co wss://<project>.supabase.co` — and
  only for the online build.
- Student login with student ID must not expose other students' full IDs (masked view only).
- Keep exports (names + full IDs) PIC-only.
