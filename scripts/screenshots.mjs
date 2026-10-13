// Regenerates the README screenshots in docs/screenshots (fake sample data).
//   npm run screenshots
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'docs', 'screenshots');
const PORT = 4321;
const server = spawn(process.execPath, [join(root, 'tests', 'server.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const BASE = `http://localhost:${PORT}/attendance-pic/`;

const browser = await chromium.launch();
const shoot = async (page, name, opts = {}) => {
  await page.waitForTimeout(500);
  // JPEG keeps the 2× (retina) screenshots small enough for the repository.
  await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 86, ...opts });
  console.log('saved', name);
};

async function prepared(colorScheme = 'light', viewport = { width: 1180, height: 820 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme, hasTouch: true });
  const page = await ctx.newPage();
  const pin = async (p) => { for (const d of p) await page.locator(`.ov-backdrop:not(.is-leaving) .pin-overlay [data-digit="${d}"]`).last().click(); };
  await page.goto(BASE);
  await pin('2580');
  await page.locator('.pin-ok').click();
  await pin('2580');
  return { ctx, page, pin };
}

async function fill(page, pin) {
  await page.getByTestId('hero-sample').click();
  await page.getByTestId('confirm-import').click();
  await page.waitForURL(/#\/attendance$/);
  await page.goto(`${BASE}#/event`);
  await page.getByTestId('ev-name').fill('Industrial Visit 2026');
  await page.getByTestId('ev-venue').fill('Port Dickson');
  await page.getByTestId('ev-pic').fill('Cik Aina');
  await page.getByTestId('ev-pic').blur();
  await page.goto(`${BASE}#/attendance`);
  const rows = page.getByTestId('att-row');
  for (let i = 0; i < 44; i++) if (i % 9 !== 4) await rows.nth(i).getByTestId('btn-present').click();
  for (const i of [4, 13, 22]) await rows.nth(i).getByTestId('btn-absent').click();
  await page.locator('[data-route=seating]').click();
  await page.getByTestId('admin-toggle').click();
  await pin('2580');
  const seat = (b, l) => page.getByTestId('bus-card').nth(b).locator(`.seat[data-seat-label="${l}"]`);
  await seat(0, '1A').click();
  await page.getByTestId('type-vip').click();
  await page.getByTestId('type-label').fill('Dr. Ahmad');
  await page.getByTestId('save-type').click();
  await seat(0, '1D').click();
  await page.getByTestId('type-reserved').click();
  await page.getByTestId('type-label').fill('Guide');
  await page.getByTestId('save-type').click();
  await seat(0, '9C').click();
  await page.getByTestId('type-unavailable').click();
  await page.getByTestId('save-type').click();
  await page.getByTestId('auto-fill').click();
  await page.getByTestId('skip-absent').uncheck();
  await page.getByTestId('confirm-autofill').click();
  await page.getByTestId('admin-toggle').click();
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  return seat;
}

// 1. Hero (empty state)
{
  const { ctx, page } = await prepared();
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await shoot(page, 'hero');
  await ctx.close();
}
// 2–5. Light mode, landscape
{
  const { ctx, page, pin } = await prepared();
  const seat = await fill(page, pin);
  await page.goto(`${BASE}#/attendance`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'attendance');
  await page.locator('[data-route=seating]').click();
  await page.getByTestId('person').first().click();
  await shoot(page, 'seating');
  await page.getByTestId('mode-banner').locator('[data-cancel]').click();
  await seat(0, '3B').click();
  await shoot(page, 'seat-sheet');
  await page.keyboard.press('Escape');
  await page.getByTestId('open-export').click();
  await page.getByTestId('fmt-pdf').click();
  await page.getByTestId('pdf-seatmaps').check();
  await shoot(page, 'export');
  // Also keep a picture of the generated PDF (needs poppler's pdftoppm; skipped if missing).
  await page.getByTestId('export-create').click();
  await page.locator('.choice[data-value=blank]').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const pdfPath = join(out, 'report.pdf');
  await dl.saveAs(pdfPath);
  const r = spawnSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=85', '-r', '90', '-f', '1', '-l', '1', '-singlefile', pdfPath, join(out, 'pdf-report')]);
  // Seat maps are the last pages (one per deck; two single-deck buses here).
  const pages = Number((/Pages:\s+(\d+)/.exec(spawnSync('pdfinfo', [pdfPath]).stdout?.toString() || '') || [])[1]) || 4;
  const first = String(pages - 1);
  const r2 = spawnSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=85', '-r', '90', '-f', first, '-l', first, '-singlefile', pdfPath, join(out, 'pdf-seatmap')]);
  if (r.status !== 0 || r2.status !== 0) console.log('pdftoppm not available — PDF previews skipped');
  rmSync(pdfPath);
  await page.keyboard.press('Escape');
  await page.getByTestId('admin-toggle').click();
  await pin('2580');
  await page.getByTestId('bus-card').nth(1).getByTestId('edit-bus').click();
  await page.getByTestId('deck-double').click();
  await page.getByTestId('layout-L-1-2').click();
  for (let i = 0; i < 6; i++) await page.getByTestId('rows-L-minus').click();
  await page.getByTestId('bench-U').click();
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await shoot(page, 'layout-editor');
  await ctx.close();
}
// 6. Dark mode seating + portrait attendance
{
  const { ctx, page, pin } = await prepared('dark');
  await fill(page, pin);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'seating-dark');
  await page.setViewportSize({ width: 834, height: 1194 });
  await page.goto(`${BASE}#/attendance`);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await shoot(page, 'attendance-portrait-dark');
  await ctx.close();
}

await browser.close();
server.kill();
