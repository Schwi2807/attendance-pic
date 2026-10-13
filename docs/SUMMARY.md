# Summary — Attendance PIC (Phase 1)

## What was built

An offline-first **PWA for iPad Safari** that a PIC uses to load a participant list, take attendance,
seat people on buses and export the result for the lecturer. Static files only (GitHub Pages),
no backend, no data leaves the device.

| Milestone | Delivered |
|---|---|
| **1. Storage, import, attendance, persistence** | Storage repository interface (`app/js/repo/repository.js`) with an IndexedDB implementation; the UI never touches IndexedDB. Import of `.xlsx`, `.csv`, `.txt` (comma / tab / semicolon detected), preview + Name/ID mapping + key-info columns, reuse of Present/Seat/Remarks (+ Bus / Check-in Time), duplicate-ID / empty-row / missing-value warnings, new-event or replace-list modes. Attendance list with sticky search, live counters + progress bar, filters, sorting, Present/Absent buttons, auto `HH:MM`, remarks, undo, admin "reset all" with confirmation, light/dark mode, ID masking. Event details form and multiple events per device. Autosave of everything. |
| **2. Bus layout engine** | Pure JSON configs (single/double deck, 2-2 / 2-3 / 1-2 / 1-3, rows, back bench, driver side), pure seat enumeration / labels (`3C`, `L3C`, `U3C`) / stable seat IDs / geometry. Redbus-style top-down SVG coach (nose, windscreen, mirrors, wheels, driver + steering wheel, door, aisle, rear, stairs, luggage area), flip per bus, responsive scaling. Automatic bus count (usable = total − unavailable − reserved − VIP) recomputed on import / layout / seat-type changes, warnings before removing buses or seats with passengers, manual mode, default template, admin layout editor with live preview, add / rename / reorder / remove buses. |
| **3. Seat assignment + admin + seat types** | Tap-tap seating (person → seat, or seat → searchable picker), seat sheet with Move / Swap / Unassign / Present / Absent, auto-fill (list order, front→back, lower deck first, skips non-available seats, never moves seated people, optional skip-absent), per-bus summaries, legend for all 7 seat states. PIN on first launch (salted SHA-256), unlock pad, 5-minute idle auto-lock, ADMIN indicator with countdown, change PIN, forgot-PIN erase. Admin-only seat types (seat sheet or "paint" tool) with labels; admins may seat people in Reserved/VIP seats. |
| **4. Exports** | XLSX (original columns + Present, Bus, Seat, Remarks, Check-in Time; Absent rows `#FDE2E2`; Event sheet), CSV (UTF-8 BOM, injection-safe), PDF (A4, auto landscape, header with counts, repeated table header, Absent rows `#FDE2E2`, page numbers; optional seat maps — one page per deck), JSON backup + admin-only restore. Unmarked → "mark Absent" or "leave blank" prompt. `Attendance_<EventName>_<YYYY-MM-DD>.<ext>`. Web Share API with files, download fallback. |
| **5. PWA, deploy, tests, docs** | Manifest + icons (incl. maskable and Apple touch icon), service worker with a versioned pre-cache of every file (works in airplane mode), update prompt. `.github/workflows/deploy.yml` (upload-pages-artifact + deploy-pages on push to `main`) and `.github/workflows/test.yml` (Chromium + WebKit). 53 Playwright tests. README with screenshots, `docs/DECISIONS.md`, `docs/PHASE2.md`, `docs/OWNER_TODO.md`. |

## Test results

Run in this environment: `npx playwright test` — **Chromium**, `iPad Pro 11 landscape` device descriptor
(1194 × 834, touch, mobile), app served under `/attendance-pic/` like GitHub Pages.

```
Running 53 tests using 4 workers (Chromium, iPad Pro 11 landscape)

  ✓ admin.spec.js           4 passed
  ✓ attendance.spec.js     10 passed
  ✓ buses.spec.js          15 passed
  ✓ export.spec.js          6 passed
  ✓ import.spec.js          5 passed
  ✓ offline.spec.js         4 passed
  ✓ persistence.spec.js     1 passed
  ✓ precache.spec.js        1 passed
  ✓ privacy.spec.js         1 passed
  ✓ seating.spec.js         6 passed

  53 passed (2.4m) — 0 failed, 0 flaky
  (an extra --repeat-each=2 run: 103/104 passed; the one flaky toast assertion was fixed and re-verified 12/12)
```

Coverage of the brief's quality list:

| Required | Test(s) |
|---|---|
| import | `import.spec.js` — xlsx, csv, tab-txt, semicolon + quotes + duplicates + empty rows, replace list |
| mark | `attendance.spec.js` — present/absent/toggle, time stamp, counter, remarks, filters, search, sort, undo, reset, 44 px targets, portrait, masking, dark mode |
| auto bus count (60 → 2) | `buses.spec.js` › auto bus count |
| every layout 2-2 / 2-3 / 1-2 / 1-3 | `buses.spec.js` › layout … (4 tests) |
| back bench | `buses.spec.js` › full back bench |
| double-decker | `buses.spec.js` › double-decker |
| flip direction | `buses.spec.js` › flip facing direction |
| admin PIN lock / unlock | `admin.spec.js` — first-launch PIN, unlock, wrong PIN, manual lock, 5-min auto-lock (fake clock), change PIN |
| seat types reduce capacity → bus count updates | `buses.spec.js` › seat types reduce capacity… |
| non-admin cannot set seat types | `buses.spec.js` › non-admin cannot set seat types; `seating.spec.js` › VIP |
| assign / move / swap | `seating.spec.js` |
| auto-fill | `seating.spec.js` (two tests incl. double-decker order) |
| reload persistence | `persistence.spec.js` |
| all exports incl. PDF with and without seat maps | `export.spec.js` (XLSX fill check, CSV, PDF table, PDF + maps, maps only, JSON backup + restore) |
| no off-origin network requests | `privacy.spec.js` + an auto fixture on **every** test (records, aborts and fails on any off-origin request, CSP violation or page error) |
| offline | `offline.spec.js` (every file in the SW cache — both browsers; offline reload + offline PDF export — Chromium), manifest, CSP; `precache.spec.js` |

**GitHub Actions (final run on `main`, commit `60a28ef`):**

| Job | Result | Time |
|---|---|---|
| chromium (iPad Pro 11) | **53 passed** | 2.5 min |
| webkit (iPad Pro 11) | **52 passed, 1 skipped** (offline reload — see below) | 9.6 min |

**WebKit:** Playwright's WebKit could not be installed in this environment (browsers are pre-provisioned;
`playwright install` is not allowed), so per the brief the suite ran on Chromium here and the README says so.
The *Tests* GitHub Action runs the same suite on **Chromium and WebKit** for every push / PR.

The first WebKit run on GitHub found a **real bug**: the admin auto-lock countdown re-rendered the seat
sheet and the seating toolbar every second while admin mode was on (on an iPad that would close the
keyboard while typing a VIP label). Fixed by giving the countdown its own `tick` event. The same run showed
that Playwright's WebKit cannot reload a page while offline emulation is on, so the end-to-end offline
test runs on Chromium, and a new cross-browser test checks that every file is in the service-worker cache.

Also checked manually (scripted): 400-person list → import < 1 s, seating render of 10 buses ≈ 0.2 s,
auto-fill of 400 ≈ 1.2 s; screenshots of every screen in light/dark, portrait/landscape; PDF pages
rendered and inspected.

## Known limitations

- **WebKit not exercised locally** (see above) — real-iPad behaviour should be confirmed once (TODO list).
- **PDF font**: built-in Helvetica (Windows-1252). Non-Latin characters print as `?`; Excel/CSV are unaffected.
- **Storage is per device & per browser container.** On iPadOS the Home Screen app and Safari tabs have
  separate storage. Deleting the Home Screen app or clearing website data deletes the data → use backups.
- **PIN is a guard-rail**, not encryption. Forgot PIN = erase app data (then restore a backup).
- One attendance session per event in the UI (model supports more). Undo history is in memory only.
- Web Share with files depends on the browser (iPad Safari: yes; desktop Chromium on Linux: falls back to download).
- Service-worker updates apply after tapping **Reload** on the update toast (or after all app windows close).
- The repository's default branch is still the session branch (`claude/gallant-euler-p8tdrn`); switch it to
  `main` (TODO list). Deploys from `main` already work.

## Deployment

PR [#1](https://github.com/Schwi2807/attendance-pic/pull/1) was merged into `main`; the *Deploy to GitHub
Pages* workflow succeeded. **Live app: https://schwi2807.github.io/attendance-pic/**

## What you need to do next

See **[`docs/OWNER_TODO.md`](OWNER_TODO.md)**. In short:

1. **Settings → General → Default branch → `main`** (recommended; deploys already work).
2. On the iPad: open the link in **Safari → Share → Add to Home Screen**, open it **from the icon** once
   online, wait for *“Ready to work offline”*, create your PIN, try the sample data, then test airplane mode.
3. Keep the repository **public** (a private repo on the free plan unpublishes the site).
4. Optionally choose a license.
