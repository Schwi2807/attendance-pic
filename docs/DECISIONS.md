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

## Seat assignment & admin mode

| # | Decision | Why |
|---|----------|-----|
| S1 | Tapping an **occupied seat while a person is selected** offers "Swap seats" (if the selected person already has a seat) or "Seat X here" (the occupant becomes unseated). | Covers both intentions without drag & drop. |
| S2 | In **Move** mode, tapping an occupied seat swaps the two passengers. | Fewer steps than cancelling and starting a swap. |
| S3 | **Auto-fill** uses the original list order and, by default, **skips people marked Absent** (checkbox in the confirmation). If there are not enough free seats it fills what it can and reports how many are left. | Absent people do not need seats; the PIC can untick the box. |
| S4 | Admins get a **"Seat types" paint tool**: choose Unavailable / Reserved / VIP / Available (+ optional label) and tap seats; tapping a seat that already has the chosen type resets it to Available. Single seats can also be set from the seat sheet. | Marking many broken seats one sheet at a time would be slow. |
| S5 | Marking an **occupied** seat **Unavailable** asks to unseat the passenger. Marking an occupied seat Reserved/VIP keeps the passenger (an admin may seat people there). | Unavailable seats cannot hold anyone; Reserved/VIP can, by admins. |
| S6 | Non-admins tapping a Reserved/VIP seat see who it is reserved for and can unlock admin mode from there. | Clear feedback instead of a dead tap. |
| S7 | The per-bus summary counts passengers in normal seats against usable seats ("One — 36/38 seated · 1 VIP · 1 reserved"). | Matches the brief's example format. |
| S8 | Admin UI elements are **hidden while locked**; actions that need admin (e.g. "Buses", reset, delete event) prompt for the PIN. The top bar shows an amber **ADMIN** pill with the auto-lock countdown and a striped amber line. | Non-admins are not confronted with controls they cannot use, yet admin actions remain discoverable. |
| S9 | Wrong PIN 5× → 30 s cool-down. **Forgot PIN** = erase all app data on this device (after typing ERASE); backups can be restored afterwards. | A local-only PIN cannot be recovered; erasing keeps the data protected. |
| S10 | The PIN is stored as a salted SHA-256 hash; PIN length is stored so the pad can auto-submit. | Convenience; the PIN is a guard-rail, not a security boundary. |
| S11 | **Phone numbers** come from an optional, auto-detected phone column (stored as `event.columns.phone`; events imported earlier fall back to a guess from their headers) and are read from the participant's original row, so nothing is duplicated. Shown in the Seating panel, seat picker and seat sheet (tap-to-call `tel:` link); search matches digits only; masked by the same privacy switch as IDs (`maskPhone()` lives next to `maskId()`). | Requested after v1.0: the PIC needs to call people who have not boarded. |

## Export

| # | Decision | Why |
|---|----------|-----|
| E1 | Export columns = original columns **except** the ones the app manages (an imported Present / Seat / Remarks / Bus / Check-in column), followed by **Present, Bus, Seat, Remarks, Check-in Time**. | Avoids two "Present" columns with conflicting values; a re-import round-trips cleanly. |
| E2 | "Mark them Absent" before export is **saved** to the list (and can be undone); "Leave blank" leaves the Present cell empty. | The export then matches what the app shows. |
| E3 | XLSX: bold header with an underline, auto column widths, auto-filter, **#FDE2E2 fill on every cell of Absent rows**, no other fills; plain integers are written as numbers, everything else (IDs, phones with leading zeros) as text. A second sheet "Event" holds event details and counts. | Clean for the lecturer; no "number stored as text" noise and no lost leading zeros. |
| E4 | CSV: UTF-8 **with BOM**, CRLF, RFC-4180 quoting; cells beginning with `= + - @` are prefixed with `'` (unless they are plain numbers). | Excel opens UTF-8 correctly; prevents spreadsheet formula injection. |
| E5 | PDF: switches to **landscape** when there are more than 8 columns or the estimated width exceeds A4 portrait. Header (event, date, venue, PIC, coloured count pills), table header repeated on every page, Absent rows #FDE2E2, "Page X of Y" footer with generation time. Seat maps: one landscape page per deck, vector-drawn from the same geometry as the screen, names in seats (2 lines max), absent seats light red with "ABSENT", VIP/Reserved labelled, legend. | Mirrors the XLSX and the on-screen map. |
| E6 | jsPDF's built-in Helvetica only covers Windows-1252; other characters are transliterated or replaced with `?` (see Known limitations). | Embedding a Unicode font would add ~300 KB+; Malaysian university lists are almost always romanised. |
| E7 | The file is generated first, then a **"ready" screen** offers **Share…** (Web Share API with files, when the browser supports it) and **Download**. | iPad Safari only allows `navigator.share` directly inside a tap; generating first and sharing on a second tap is reliable. |
| E8 | JSON backup file name follows the same pattern (`Attendance_<Event>_<date>.json`); restoring is admin-only and replaces an event with the same ID (asks first). Restore works on a fresh device too (Event tab). | Same naming rule as the brief; restoring overwrites data so it is protected. |
| E9 | File name: `<EventName>` keeps letters, digits, `-` and `_`, spaces become `_`; `<YYYY-MM-DD>` is the event date (today if empty). | Safe on iOS, Windows and macOS. |

## PWA, deployment & tests

| # | Decision | Why |
|---|----------|-----|
| P1 | Service worker = **versioned pre-cache of every app file**, cache-first for same-origin GETs, navigations answered with the cached `index.html`, other origins never intercepted. The deploy workflow replaces `__BUILD__` with the commit SHA, so each deploy installs a fresh cache and the app offers **"Reload"** for the new version. | Fully offline after the first visit, atomic updates, no stale mixes of old and new files. |
| P2 | `tests/precache.spec.js` fails if a file in `app/` is missing from the pre-cache list. | Prevents "works online, broken offline" after adding a file. |
| P3 | The local/test server serves the app under **`/attendance-pic/`**, like a GitHub Pages project site. All paths in the app are relative. | Catches absolute-path bugs before deploying. |
| P4 | Playwright runs on **Chromium with the iPad Pro 11 (landscape) descriptor** in this environment; WebKit could not be installed here (browsers are pre-provisioned and `playwright install` is not permitted). The **Tests** workflow runs the same suite on Chromium **and WebKit** (`PW_WEBKIT=1`). | The brief: run on Chromium if WebKit is unavailable, don't skip tests; CI still covers Safari's engine. |
| P5 | Every test runs inside a fixture that **aborts and fails on any off-origin request**, any **CSP violation** and any uncaught page error; a dedicated end-to-end privacy test exercises every feature and export. Service workers are blocked in tests except the offline test. | Makes the privacy guarantee a regression test, not a promise. |
| P6 | The deploy workflow is **independent of the test workflow** (deploys on every push to `main`, as requested). | A WebKit-only flake should not block publishing; the test badge shows status. |
| P7 | `navigator.storage.persist()` is requested at start-up. | Reduces the chance of Safari evicting data for a site not used for a while. |
| P8 | README screenshots are 2× JPEGs generated by `npm run screenshots` from fake data (~2 MB total). | Crisp on retina screens without bloating the repository. |
| P9 | No `LICENSE` file was added. | Choosing a license is the owner's decision (listed in OWNER_TODO.md). |
| P10 | The PIN screen cannot be dismissed on first launch; a "Restore a backup" shortcut is offered on the empty start screen. | The brief requires a PIN on first launch; restoring on a new iPad is a common first step. |
| P11 | The admin countdown dispatches a separate **`tick`** event (only the ADMIN pill listens); `change` fires only on lock/unlock. | Found by the first WebKit CI run: re-rendering every second detached buttons and would close the iPad keyboard while typing. |
| P12 | Tests run with **`reducedMotion: 'reduce'`** (the app honours it), and the end-to-end *offline reload* test is Chromium-only; WebKit checks the service-worker cache contents instead. | Playwright's WebKit raises "internal error" on reload while offline-emulated; animations are decorative and only slow down stability checks. |
| P13 | No full-screen `backdrop-filter` behind dialogs, no `background-attachment: fixed`, and no CSS `drop-shadow` filters on bus bodies / the selected seat (an offset shape and a stroke pulse instead). | GPU-less WebKit on CI spent seconds per frame on them (tests took 25–60 s each); cheaper painting also helps older iPads. |
| P14 | CI runs Chromium and WebKit as **two parallel jobs** with a 25-minute limit and `--max-failures=8`; newer runs cancel older ones on the same branch. | Fast, separate signal per engine; a slow browser can never look like a frozen run. |
| P15 | The deploy workflow only runs when `app/`, `samples/` or the workflow itself change (plus manual runs). | Each deploy stamps a new service-worker version, which makes installed iPads offer an update; docs-only changes should not. |
