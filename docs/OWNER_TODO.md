# Things only the repository owner can do

These need your GitHub account or your iPad. Everything else is done.

## 1. Turn GitHub Pages back on (required, one time)

**Settings → Pages → Build and deployment → Source: “GitHub Actions”.**

Then start the first deployment: **Actions → Deploy to GitHub Pages → Run workflow** (branch `main`).
When it is green, the app is at **https://schwi2807.github.io/attendance-pic/**. After that, every push to
`main` that changes the app redeploys it automatically.

If a workflow ever complains that an action version is deprecated, bump the version number in
`.github/workflows/*.yml` (GitHub currently warns that some actions still target Node.js 20; they keep
working because GitHub runs them on Node.js 24).

## 2. WebKit (Safari engine) tests

The *Tests* workflow runs the suite on Chromium **and** WebKit as two parallel jobs on every push to `main`
and every pull request. WebKit skips one test (offline reload, which Playwright cannot emulate on WebKit)
and checks the offline cache instead. Real-iPad confirmation is step 3.

## 3. Install on your iPad (once)

1. Open https://schwi2807.github.io/attendance-pic/ in **Safari** → **Share → Add to Home Screen**.
2. Open the app **from the Home Screen icon** (it has its own storage, separate from Safari tabs).
3. Wait for *“Ready to work offline”*, create your **admin PIN**.
4. Try **“Try sample data”**, play with it, then delete that sample event (*Event → Events on this iPad → 🗑*).
5. Turn on airplane mode and reopen the app to confirm it works offline.

## 4. Before every event

Follow the *Pre-event checklist* in the README (cache online, PIN, test import, bus setup, backup habit).

## 5. Optional

- **Choose a license** for the repository (none was added — that is your call). MIT is common for small tools.
- **Keep the repository public.** Making it private on the free plan unpublishes the site: installed iPads keep
  working from their offline copy, but cannot update, and a new install (or a reinstall after the cache is
  cleared) is impossible until it is public again. GitHub Pro, Cloudflare Pages or Netlify can serve a private repo.
- Protect `main` if you want pull requests reviewed before deploys.
- Replace `Cik Aina` / `Industrial Visit 2026` (invented) in `scripts/screenshots.mjs` if you regenerate screenshots.
