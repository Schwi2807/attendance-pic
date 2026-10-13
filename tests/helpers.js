// Shared test helpers + an auto fixture that fails any test which makes a
// request to another origin, violates the CSP, or throws a page error.
import { test as base, expect } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SAMPLES = join(ROOT, 'samples');
export const PIN = '2580';

export const test = base.extend({
  guard: [
    async ({ page, baseURL }, use) => {
      const origin = new URL(baseURL).origin;
      const offOrigin = [];
      const errors = [];
      page.context().on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return;
        if (new URL(url).origin !== origin) offOrigin.push(url);
      });
      // Belt and braces: anything off-origin is aborted, so it can never leave.
      await page.context().route((url) => url.origin !== origin && url.protocol !== 'data:' && url.protocol !== 'blob:', (route) => {
        offOrigin.push(route.request().url());
        return route.abort();
      });
      await page.addInitScript(() => {
        window.__csp = [];
        document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use({ offOrigin, errors });
      expect(offOrigin, 'requests to other origins').toEqual([]);
      expect(errors, 'uncaught page errors').toEqual([]);
      const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
      expect(csp, 'Content-Security-Policy violations').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export async function pressPin(page, pin = PIN) {
  // The previous pad may still be animating out — target the live one.
  for (const d of pin) await page.locator(`.ov-backdrop:not(.is-leaving) .pin-overlay [data-digit="${d}"]`).last().click();
}

/** First launch: open the app and create the admin PIN. */
export async function openFresh(page, pin = PIN) {
  await page.goto('./');
  await expect(page.locator('.pin-overlay')).toBeVisible();
  await pressPin(page, pin);
  await page.locator('.pin-ok').click();
  await pressPin(page, pin);
  await expect(page.locator('.pin-overlay')).toHaveCount(0);
}

/** Imports a sample file through the real import wizard. */
export async function importFile(page, file, { expectCount } = {}) {
  const hero = page.getByTestId('hero-import');
  if (await hero.isVisible().catch(() => false)) await hero.click();
  else {
    await page.goto('./#/event');
    await page.getByTestId('ev-import').click();
  }
  await page.getByTestId('file-input').setInputFiles(typeof file === 'string' ? join(SAMPLES, file) : file);
  await expect(page.getByTestId('confirm-import')).toBeEnabled();
  if (expectCount) await expect(page.getByTestId('import-count')).toHaveText(`${expectCount} participants`);
  await page.getByTestId('confirm-import').click();
  // The wizard switches to the Attendance tab when it is done.
  await expect(page).toHaveURL(/#\/attendance$/);
  await expect(page.getByTestId('att-list')).toBeVisible();
}

export async function setupWithSample(page, file = 'participants_sample.xlsx') {
  await openFresh(page);
  await importFile(page, file, { expectCount: 60 });
}

export async function unlockAdmin(page, pin = PIN) {
  await page.getByTestId('admin-toggle').click();
  await pressPin(page, pin);
  await expect(page.getByTestId('admin-toggle')).toHaveAttribute('data-state', 'unlocked');
}

export async function lockAdmin(page) {
  await page.getByTestId('admin-toggle').click();
  await expect(page.getByTestId('admin-toggle')).toHaveAttribute('data-state', 'locked');
}

export const row = (page, n) => page.getByTestId('att-row').nth(n);
export const busCard = (page, n) => page.getByTestId('bus-card').nth(n);
export const seat = (page, busIndex, label) => busCard(page, busIndex).locator(`.seat[data-seat-label="${label}"]`);

export async function goSeating(page) {
  await page.locator('[data-route=seating]').click();
  await expect(page.getByTestId('bus-list')).toBeVisible();
}

export async function seatCountOf(page, busIndex) {
  return busCard(page, busIndex).locator('.seat').count();
}

/** Waits (auto-retrying) until a bus shows `n` seats. */
export async function expectSeats(page, busIndex, n) {
  await expect(busCard(page, busIndex).locator('.seat')).toHaveCount(n);
}

/** Opens the layout editor of a bus (admin must be unlocked). */
export async function openLayout(page, busIndex = 0) {
  await busCard(page, busIndex).getByTestId('edit-bus').click();
  await expect(page.getByTestId('layout-editor')).toBeVisible();
}

export function csvFile(name, text) {
  return { name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') };
}
