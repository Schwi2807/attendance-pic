# Rules for AI assistants working on this repository

## Privacy of the repository owner — absolute rule

- **Never write the repository owner's personal name, nickname, initials or e-mail address anywhere** in
  this project: source code, tests, test data, sample files, screenshots, docs, file or folder names,
  branch names, commit messages, pull-request or issue text, review comments, release notes, workflow
  logs you trigger. Not even in a commit or PR that removes such a reference.
- Refer to them only as "the owner", "the repository owner" or "the PIC".
- Test data, samples and screenshots use **invented** names only (see `scripts/make-samples.mjs` and
  `scripts/screenshots.mjs`).
- Commits are authored and committed as `Claude <noreply@anthropic.com>`.

## Participant privacy

- Commit only the fake lists in `/samples`. `.gitignore` blocks other `.xlsx` / `.csv` / `.txt` files and
  `/private/`.
- The app must make no network requests except to its own origin (CSP in `app/index.html`; enforced by
  the Playwright fixture in `tests/helpers.js`).

## Working on the code

- No build step: `app/` is plain ES modules, CSS and inline SVG; `npm start` serves it under
  `/attendance-pic/` like GitHub Pages.
- `npm test` runs Playwright (iPad Pro 11, Chromium); CI also runs WebKit.
- Adding a file to `app/` → add it to `PRECACHE` in `app/sw.js` (`tests/precache.spec.js` checks).
- Judgement calls go into `docs/DECISIONS.md`.
