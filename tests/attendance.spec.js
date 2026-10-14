import { test, expect, setupWithSample, row, unlockAdmin, pressPin } from './helpers.js';

test.describe('Attendance', () => {
  test.beforeEach(async ({ page }) => setupWithSample(page));

  test('mark present / absent with HH:MM time stamp, live counter, toggle off', async ({ page }) => {
    const r0 = row(page, 0);
    await r0.getByTestId('btn-present').click();
    await expect(r0).toHaveAttribute('data-status', 'present');
    await expect(r0.getByTestId('btn-present')).toHaveAttribute('aria-pressed', 'true');
    // "{date}, {HH:mm}", e.g. "13 Oct 2026, 08:15" — today's date
    const now = new Date();
    const today = `${String(now.getDate()).padStart(2, '0')} ${now.toLocaleString('en', { month: 'short' })} ${now.getFullYear()}`;
    await expect(r0.getByTestId('att-time')).toHaveText(new RegExp(`^${today}, \\d{2}:\\d{2}$`));
    await row(page, 1).getByTestId('btn-absent').click();
    await expect(page.getByTestId('counter')).toHaveAttribute('aria-label', '1 present, 1 absent, 58 unmarked of 60');
    // tapping the active button again un-marks
    await r0.getByTestId('btn-present').click();
    await expect(r0).toHaveAttribute('data-status', 'unmarked');
    await expect(r0.getByTestId('att-time')).toHaveText('—');
    await expect(page.getByTestId('counter')).toHaveAttribute('aria-label', '0 present, 1 absent, 59 unmarked of 60');
  });

  test('remarks are saved per row', async ({ page }) => {
    const r = row(page, 2);
    await r.locator('[data-act=remark]').click();
    await r.getByTestId('remark-input').fill('Left early');
    await r.getByTestId('remark-input').press('Enter');
    await expect(r.getByTestId('att-remark')).toHaveText('Left early');
  });

  test('search by name and ID, filters and sorting', async ({ page }) => {
    await row(page, 0).getByTestId('btn-present').click();
    await row(page, 1).getByTestId('btn-absent').click();
    await page.getByTestId('search').fill('ad250003');
    await expect(page.getByTestId('att-row')).toHaveCount(1);
    await expect(row(page, 0).getByTestId('att-name')).toHaveText('Wong Kok Wai');
    await page.getByTestId('search').fill('siti hajar');
    await expect(page.getByTestId('att-row').first().getByTestId('att-name')).toContainText('Siti Hajar');
    await page.getByTestId('search').fill('');
    await page.locator('[data-filter=present]').click();
    await expect(page.getByTestId('att-row')).toHaveCount(1);
    await page.locator('[data-filter=absent]').click();
    await expect(page.getByTestId('att-row')).toHaveCount(1);
    await page.locator('[data-filter=unmarked]').click();
    await expect(page.getByTestId('att-row')).toHaveCount(58);
    await page.locator('[data-filter=unseated]').click();
    await expect(page.getByTestId('att-row')).toHaveCount(60);
    await page.locator('[data-filter=all]').click();
    await page.getByTestId('sort').selectOption('name');
    const names = await page.getByTestId('att-name').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    await page.getByTestId('sort').selectOption('id');
    await expect(row(page, 0).getByTestId('att-id')).toHaveText('AD250001');
  });

  test('marked row leaves the Unmarked filter', async ({ page }) => {
    await page.locator('[data-filter=unmarked]').click();
    await row(page, 0).getByTestId('btn-present').click();
    await expect(page.getByTestId('att-row')).toHaveCount(59);
  });

  test('undo last action', async ({ page }) => {
    await row(page, 0).getByTestId('btn-present').click();
    await row(page, 1).getByTestId('btn-absent').click();
    await page.getByTestId('undo').click();
    await expect(row(page, 1)).toHaveAttribute('data-status', 'unmarked');
    await expect(row(page, 0)).toHaveAttribute('data-status', 'present');
    await page.getByTestId('undo').click();
    await expect(row(page, 0)).toHaveAttribute('data-status', 'unmarked');
    await expect(page.getByTestId('undo')).toBeDisabled();
  });

  test('reset all needs admin and a confirmation', async ({ page }) => {
    await row(page, 0).getByTestId('btn-present').click();
    await row(page, 1).getByTestId('btn-absent').click();
    await page.getByTestId('att-more').click();
    await page.locator('.choice[data-value=reset]').click();
    // locked → PIN prompt first
    await expect(page.locator('.pin-overlay')).toBeVisible();
    await pressPin(page);
    await page.getByTestId('reset-go').click();
    // confirmation step — cancel keeps everything
    await page.getByRole('dialog', { name: 'Are you sure?' }).locator('[data-action=cancel]').click();
    await expect(row(page, 0)).toHaveAttribute('data-status', 'present');
    await page.getByTestId('att-more').click();
    await page.locator('.choice[data-value=reset]').click();
    await page.getByTestId('reset-go').click();
    const confirm = page.getByRole('dialog', { name: 'Are you sure?' });
    await expect(confirm).toBeVisible();
    await confirm.locator('[data-action=ok]').click();
    await expect(page.getByTestId('counter')).toHaveAttribute('aria-label', '0 present, 0 absent, 60 unmarked of 60');
  });

  test('touch targets are at least 44 px', async ({ page }) => {
    for (const id of ['btn-present', 'btn-absent']) {
      const box = await row(page, 0).getByTestId(id).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    const chip = await page.locator('[data-filter=all]').boundingBox();
    expect(chip.height).toBeGreaterThanOrEqual(40);
  });

  test('portrait iPad layout keeps buttons reachable', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1194 });
    const box = await row(page, 0).getByTestId('btn-absent').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(834);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await row(page, 0).getByTestId('btn-absent').click();
    await expect(row(page, 0)).toHaveClass(/is-absent/);
  });

  test('ID masking setting', async ({ page }) => {
    await page.goto('./#/event');
    await page.getByTestId('mask-toggle').click();
    await page.goto('./#/attendance');
    await expect(row(page, 0).getByTestId('att-id')).toHaveText('AD••••••');
    // search still works on the real ID
    await page.getByTestId('search').fill('AD250002');
    await expect(page.getByTestId('att-row')).toHaveCount(1);
  });
});

test('dark mode applies dark colours', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await setupWithSample(page);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(9, 13, 22)');
  await unlockAdmin(page);
});
