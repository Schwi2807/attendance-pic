# Things only you can do

These need your GitHub account or your iPad. Everything else is done.

## 1. Let GitHub Pages publish from `main` (required)

At the end of the session the repository was already **public** with Pages switched on — thanks!
Two settings still need a click, because the repository was empty when work started and GitHub made the
first pushed branch (`claude/gallant-euler-p8tdrn`) the **default branch**:

1. **Settings → General → Default branch** → switch to **`main`**.
2. **Settings → Pages → Build and deployment → Source** → make sure it says **“GitHub Actions”**.
3. **Settings → Environments → `github-pages` → Deployment branches and tags** → make sure **`main`** is
   allowed (GitHub usually pre-fills the default branch there; if it lists only
   `claude/gallant-euler-p8tdrn`, add `main` or switch to “No restriction”).

## 2. Run the deployment

The work was merged into `main` at the end of the session (see `docs/SUMMARY.md`). If the *Deploy to GitHub
Pages* run on `main` failed because of the settings above:

- *Actions → Deploy to GitHub Pages → Run workflow* (branch `main`), **or** push any commit to `main`.
- When it is green, the app is at **https://schwi2807.github.io/attendance-pic/**.
- Afterwards you can delete the `claude/gallant-euler-p8tdrn` branch.

If a workflow ever complains that an action version is deprecated, bump the version number in
`.github/workflows/deploy.yml` (e.g. `actions/upload-pages-artifact@v3` → the newest major).

## 3. Check the WebKit (Safari engine) test run

The build environment could not install Playwright's WebKit, so the 53 tests were run on Chromium with an
iPad viewport. The *Tests* workflow runs them on **Chromium and WebKit**. Open *Actions → Tests* and check
the latest run on `main`. If a WebKit-only failure shows up, open a new Claude session with the log.

## 4. Install on your iPad (once)

1. Open https://schwi2807.github.io/attendance-pic/ in **Safari** → **Share → Add to Home Screen**.
2. Open the app **from the Home Screen icon** (it has its own storage, separate from Safari tabs).
3. Wait for *“Ready to work offline”*, create your **admin PIN**.
4. Try **“Try sample data”**, play with it, then delete that sample event (*Event → Events on this iPad → 🗑*).
5. Turn on airplane mode and reopen the app to confirm it works offline.

## 5. Before every event

Follow the *Pre-event checklist* in the README (cache online, PIN, test import, bus setup, backup habit).

## 6. Optional

- **Choose a license** for the repository (none was added — that is your call). MIT is common for small tools.
- Rename the default branch / protect `main` if you want PRs reviewed before deploys.
- Replace `Cik Aina` / `Industrial Visit 2026` in `scripts/screenshots.mjs` if you regenerate screenshots.
