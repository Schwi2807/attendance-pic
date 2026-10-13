# Decisions log

This project was built in an unattended session. Wherever the brief was
ambiguous, the most reasonable option was chosen and recorded here with the
reasoning, so it can be revisited later.

## Architecture

| # | Decision | Why |
|---|----------|-----|
| A1 | The deployable app lives in **`/app`**; the deploy workflow publishes `app/` plus `samples/` as the site root. | Keeps tests, docs and tooling out of the public site while still letting the app offer "Try sample data". |
| A2 | **No framework, no build step**: native ES modules, one small `store.js` (state + actions) and view modules that patch the DOM. | Matches the brief, loads instantly offline and is easy for anyone forking the repo to read. |
| A3 | **All persistence goes through `repo/repository.js`** (contract documented at the top of the file). `repo/indexeddb.js` is the only file that touches IndexedDB. | Phase 2 can drop in a Supabase-backed class with the same methods. |
| A4 | Seat assignments are stored as `(sessionId, seatId) → participantId` with a **unique index on `(sessionId, participantId)`**. | The database itself prevents double-seating, mirroring the unique constraints a Phase 2 server would use. |
| A5 | Attendance and seat assignments are keyed by **session** (an event has `sessions[]`, the UI uses one). Buses and seat types belong to the **event**. | The brief asks the model to allow multiple sessions later (e.g. outbound/return) without a UI now. |
| A6 | Vendored libraries are **lazy-loaded** on first import/export (`io/vendor.js`) and pre-cached by the service worker. | ~900 KB of libraries do not slow down app start; they still work offline. |
| A7 | **Content-Security-Policy** forbids inline scripts and inline styles; dynamic values use `element.style`/CSS variables. | Strongest policy that still allows blob downloads and generated images. |

## Import

| # | Decision | Why |
|---|----------|-----|
| I1 | The header is the **first non-empty row** (toggle "First row is the header" off to get "Column 1…N"). Blank/duplicate header names are made unique. | Handles most lecturer spreadsheets; a toggle covers files without headers. |
| I2 | Besides Present / Seat / Remarks, the importer also recognises **Bus** and **Check-in Time** columns. | Those are written by our own export, so an exported file can be re-imported without losing seats or times. |
| I3 | Present values understood: present/p/yes/y/1/true/hadir/✓ → Present; absent/a/no/n/0/false/tidak hadir → Absent; anything else → unmarked. | Covers English and Malay lists. |
| I4 | **Duplicate IDs are imported, not dropped** (after a warning and confirmation). Rows with only a name or only an ID are kept with a warning; completely empty rows are skipped. | Losing a participant silently is worse than a duplicate the PIC can see. |
| I5 | Importing when an event already exists offers **"New event"** (default) or **"Replace list"** (keeps details, buses and seat types; clears attendance and seats). | Both workflows are common: a new trip vs. a corrected list. |
| I6 | A new event is named after the file and its **date defaults to today**. | Exports need a date for the file name; it can be edited any time. |
| I7 | Up to 3 "key info" columns are shown on each row (auto-picks the first two non-mapped columns, e.g. Programme, Group). | The brief asks for "key info" without naming columns. |

## Attendance

| # | Decision | Why |
|---|----------|-----|
| T1 | Tapping the active button again **un-marks** the row. | Fast correction; undo is still available. |
| T2 | Time stamp is set on the **first status change**, **refreshed on Absent → Present** (that is the real check-in of a latecomer) and **cleared when un-marked**. | Keeps "Check-in Time" truthful in the export. |
| T3 | Export column "Check-in Time" is filled only for **Present** rows. | An absent person has no check-in. |
| T4 | Undo covers marks, remarks, bulk "mark unmarked absent", seat moves/swaps/auto-fill, seat types and resets (50 steps, in memory). Structural bus changes clear the undo history. | Old seat snapshots would point at seats that no longer exist. |
| T5 | Search also matches an exact seat label (e.g. "3C"). | Handy when someone says "I'm in 3C". |
| T6 | Rows that stop matching the active filter slide out after marking. | With the "Unmarked" filter the list shrinks as people are ticked off. |
