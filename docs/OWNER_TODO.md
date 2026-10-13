# Things only you can do

These need your GitHub account or your iPad. Everything else is done.

## 1. ✅ Done — the app is live

The repository is public, Pages is on, PR #1 was merged into `main` and the *Deploy to GitHub Pages*
workflow succeeded: **https://schwi2807.github.io/attendance-pic/**. Every push to `main` redeploys it.

## 2. Switch the default branch to `main` (recommended)

The repository was empty when work started, so GitHub made the first pushed branch
(`claude/gallant-euler-p8tdrn`) the **default branch**. Change it so new pull requests target `main`:
**Settings → General → Default branch → switch to `main`.** Afterwards you can delete the
`claude/gallant-euler-p8tdrn` branch.

If a workflow ever complains that an action version is deprecated, bump the version number in
`.github/workflows/*.yml` (GitHub currently warns that some actions still target Node.js 20; they keep
working because GitHub runs them on Node.js 24).

## 3. ✅ Done — WebKit (Safari engine) tests

The *Tests* workflow runs the suite on Chromium **and** WebKit as two parallel jobs. On `main`:
Chromium 53/53 passed, WebKit 52 passed + 1 skipped (the offline-reload test, which Playwright cannot do on
WebKit; the WebKit job checks the offline cache instead). Real-iPad confirmation is step 4.

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
- **Keep the repository public.** Making it private on the free plan unpublishes the site: installed iPads keep
  working from their offline copy, but cannot update, and a new install (or a reinstall after the cache is
  cleared) is impossible until it is public again. GitHub Pro, Cloudflare Pages or Netlify can serve a private repo.
- Rename the default branch / protect `main` if you want PRs reviewed before deploys.
- Replace `Cik Aina` / `Industrial Visit 2026` in `scripts/screenshots.mjs` if you regenerate screenshots.
