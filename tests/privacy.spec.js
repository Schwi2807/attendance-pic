// End-to-end privacy check: a full session (import, attendance, seating,
// admin, every export, backup) must not send a single request to another
// origin. The shared `guard` fixture records every request of the browser
// context, aborts anything off-origin and fails the test if there was any.
import { test, expect, setupWithSample, row, goSeating, unlockAdmin, seat } from './helpers.js';

test('no request ever leaves the origin during a full session', async ({ page, guard }) => {
  const seen = new Set();
  page.on('request', (r) => seen.add(new URL(r.url()).origin));
  await setupWithSample(page);
  for (let i = 0; i < 10; i++) await row(page, i).getByTestId(i % 4 ? 'btn-present' : 'btn-absent').click();
  await goSeating(page);
  await page.getByTestId('auto-fill').click();
  await page.getByTestId('confirm-autofill').click();
  await unlockAdmin(page);
  await seat(page, 1, '10D').click();
  await page.getByTestId('type-vip').click();
  await page.getByTestId('save-type').click();
  for (const fmt of ['xlsx', 'csv', 'pdf', 'json']) {
    await page.getByTestId('open-export').click();
    await page.getByTestId(`fmt-${fmt}`).click();
    if (fmt === 'pdf') await page.getByTestId('pdf-seatmaps').check();
    await page.getByTestId('export-create').click();
    if (fmt !== 'json') await page.locator('.choice[data-value=blank]').click();
    await expect(page.getByTestId('export-ready')).toBeVisible();
    await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
    await page.keyboard.press('Escape');
  }
  await page.reload();
  await expect(page.getByTestId('att-list').or(page.getByTestId('bus-list'))).toBeVisible();
  expect(guard.offOrigin).toEqual([]);
  expect([...seen]).toEqual([new URL(page.url()).origin]);
});
