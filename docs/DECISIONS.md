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

## Bus layouts & rendering

| # | Decision | Why |
|---|----------|-----|
| B1 | Seat IDs are `"<busId>.<deck>.<row><letter>"`; a single-decker uses deck `L` internally and shows labels without the prefix (`3C`), a double-decker shows `L3C` / `U3C`. | Switching single ⇄ double keeps every lower-deck seat ID (and its passenger). IDs are unique per event because bus IDs are random. |
| B2 | "Left to right" lettering is taken **facing forward** (A = left window). With the default orientation (nose on the left of the screen) the bus's left side is drawn at the **bottom**; flipping is a true 180° turn. | A geometrically correct top-down view, so the iPad picture matches the real bus. |
| B3 | Default **driver on the right, door front-left** (Malaysia / UK, right-hand drive); "Driver side" is selectable in the layout editor. | The PIC operates in Malaysia (matric numbers like AD250001), but forks elsewhere can switch. |
| B4 | **Back bench** = the last row gets one extra seat in the aisle position and is lettered left to right across the full row (2-2 → A B C D E). | Literal application of the lettering rule; the bench seats are spread evenly like a real rear bench. |
| B5 | Double-decker: both decks share one body length; if the lower deck has fewer rows the rest is drawn as **"Luggage / open area"**. Stairs sit behind the door on both decks at the same position. Decks are stacked **Lower first, then Upper**. | One vehicle has one length; lower decks of Malaysian double-deckers typically hold few seats plus luggage. Lower-first matches the fill order. |
| B6 | Seat sizes by layout: 2-2 and 1-3 → 46 px wide, 2-3 → 41 px, 1-2 (VIP) → 54 px, all 52 px long, rows 62 px apart. Rows 1–20 per deck. | Keeps seats ≥ 44 px tap targets at 1× in iPad landscape. |
| B7 | **Bus count mode**: `auto` (default) adds/removes trailing buses so usable seats ≥ participants; adding or removing a bus by hand switches to `manual`. Declining a removal warning keeps the bus and switches to manual. | The brief describes auto mode and admin add/remove; a mode flag lets both coexist predictably. |
| B8 | Editing the **default template** affects future auto-added buses; the editor offers "Also apply to all existing buses". | Each bus is independent per the brief; bulk-apply is opt-in. |
| B9 | **Flip** is available to everyone (it is a viewing preference, stored per bus). Layout, rename, add/remove buses and the template are admin-only. | Flip does not change data that matters for seating. |
| B10 | Changing a layout so seats with passengers disappear asks first; seat types on removed seats are discarded. Structural bus changes clear the undo history. | Prevents silent unseating and stale undo snapshots. |
