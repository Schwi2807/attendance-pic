import { test, expect, setupWithSample, unlockAdmin, lockAdmin, goSeating, busCard, seat, openLayout, row } from './helpers.js';

test.describe('Seat assignment', () => {
  test.beforeEach(async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
  });

  test('tap participant then seat; tap empty seat then pick', async ({ page }) => {
    await page.getByTestId('person').first().click();
    await expect(page.getByTestId('mode-banner')).toContainText('Aiman bin Rahman');
    await seat(page, 0, '1A').click();
    await expect(seat(page, 0, '1A')).toHaveAttribute('data-state', 'assigned');
    await expect(seat(page, 0, '1A')).toContainText('Aiman');
    await seat(page, 0, '1B').click();
    await page.getByTestId('picker-search').fill('AD250002');
    await page.getByTestId('picker-list').getByTestId('person').first().click();
    await expect(seat(page, 0, '1B')).toContainText('Hajar'); // seat shows the distinctive name
    await expect(page.getByTestId('unseated-count')).toHaveText('58 unseated');
    await page.locator('[data-route=attendance]').click();
    await expect(row(page, 0).getByTestId('att-seat')).toHaveText('One · 1A');
  });

  test('portrait: People opens the participants panel; picking someone closes it', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1194 });
    const panel = page.getByTestId('seat-panel');
    await expect(panel).not.toBeInViewport();
    await page.locator('[data-act=panel]').click();
    await expect(panel).toBeInViewport();
    await expect(page.getByTestId('select-mode')).toBeInViewport();
    await page.getByTestId('panel-close').click();
    await expect(panel).not.toBeInViewport();
    await page.locator('[data-act=panel]').click();
    await panel.getByTestId('person').first().click();
    await expect(panel).not.toBeInViewport();
    await seat(page, 0, '1A').click();
    await expect(seat(page, 0, '1A')).toContainText('Aiman');
  });

  test('move, swap and unassign', async ({ page }) => {
    await page.getByTestId('person').first().click();
    await seat(page, 0, '1A').click();
    await page.getByTestId('person').first().click(); // next unseated: Siti
    await seat(page, 0, '1B').click();
    // move Aiman 1A → Two 3C
    await seat(page, 0, '1A').click();
    await expect(page.getByTestId('sheet-name')).toHaveText('Aiman bin Rahman');
    await page.getByTestId('sheet-move').click();
    await expect(page.getByTestId('mode-banner')).toContainText('Moving');
    await seat(page, 1, '3C').click();
    await expect(seat(page, 0, '1A')).toHaveAttribute('data-state', 'available');
    await expect(seat(page, 1, '3C')).toContainText('Aiman');
    // swap Two 3C ⇄ One 1B
    await seat(page, 1, '3C').click();
    await page.getByTestId('sheet-swap').click();
    await seat(page, 0, '1B').click();
    await expect(seat(page, 0, '1B')).toContainText('Aiman');
    await expect(seat(page, 1, '3C')).toContainText('Hajar');
    // unassign
    await seat(page, 0, '1B').click();
    await page.getByTestId('sheet-unassign').click();
    await expect(seat(page, 0, '1B')).toHaveAttribute('data-state', 'available');
    await expect(page.getByTestId('unseated-count')).toHaveText('59 unseated');
  });

  test('mark absent from the seat sheet paints the seat light red', async ({ page }) => {
    await page.getByTestId('person').first().click();
    await seat(page, 0, '2C').click();
    await seat(page, 0, '2C').click();
    await page.getByTestId('sheet-absent').click();
    await expect(page.getByTestId('sheet-status')).toHaveText('Absent');
    await page.keyboard.press('Escape');
    await expect(seat(page, 0, '2C')).toHaveClass(/seat--absent/);
    const fill = await seat(page, 0, '2C').locator('.seat-base').evaluate((el) => getComputedStyle(el).fill);
    expect(fill).toBe('rgb(253, 226, 226)');
  });

  test('auto-fill: list order, front to back, never moves seated people', async ({ page }) => {
    // Seat participant #3 (Wong Kok Wai) manually at the back of bus Two first.
    await page.getByTestId('panel-search').fill('AD250003');
    await page.getByTestId('person').first().click();
    await seat(page, 1, '10D').click();
    await page.getByTestId('panel-search').fill('');
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('confirm-autofill').click();
    await expect(page.getByTestId('unseated-count')).toHaveText('0 unseated');
    await expect(seat(page, 0, '1A')).toContainText('Aiman');
    await expect(seat(page, 0, '1B')).toContainText('Hajar'); // seat shows the distinctive name
    await expect(seat(page, 0, '1C')).toContainText('Danial'); // #4 — #3 kept their seat
    await expect(seat(page, 1, '10D')).toContainText('Wong');
    await expect(busCard(page, 0).getByTestId('bus-summary')).toHaveText('One — 40/40 seated');
    await expect(busCard(page, 1).getByTestId('bus-summary')).toHaveText('Two — 20/40 seated');
    // undo restores the previous seating
    await page.locator('.toast-action').last().click();
    await expect(page.getByTestId('unseated-count')).toHaveText('59 unseated');
  });

  test('auto-fill skips non-available seats and fills the lower deck first', async ({ page }) => {
    await unlockAdmin(page);
    await openLayout(page, 0);
    await page.getByTestId('deck-double').click();
    for (let i = 0; i < 7; i++) await page.getByTestId('rows-L-minus').click(); // L: 3 rows × 4 = 12
    await page.getByTestId('save-layout').click();
    await seat(page, 0, 'L1A').click();
    await page.getByTestId('type-unavailable').click();
    await page.getByTestId('save-type').click();
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('confirm-autofill').click();
    await expect(seat(page, 0, 'L1A')).toHaveAttribute('data-state', 'unavailable');
    await expect(seat(page, 0, 'L1B')).toContainText('Aiman');
    await expect(seat(page, 0, 'U1A')).toContainText(/\w/); // 12th person → first upper seat
    const lowerFull = await busCard(page, 0).locator('.deck--L .seat[data-state=assigned]').count();
    expect(lowerFull).toBe(11);
  });

  test('admin can seat someone in a VIP seat; non-admin cannot', async ({ page }) => {
    await unlockAdmin(page);
    await seat(page, 0, '1A').click();
    await page.getByTestId('type-vip').click();
    await page.getByTestId('type-label').fill('Dr. Ahmad');
    await page.getByTestId('save-type').click();
    await lockAdmin(page);
    // non-admin: select a person, tap the VIP seat → PIN prompt, cancel → nothing changes
    await page.getByTestId('person').first().click();
    await seat(page, 0, '1A').click();
    await expect(page.locator('.pin-overlay')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(seat(page, 0, '1A')).not.toHaveClass(/seat--assigned|seat--present/);
    await expect(seat(page, 0, '1A').locator('.seat-dot')).toHaveCount(0);
    // admin: allowed
    await unlockAdmin(page);
    await seat(page, 0, '1A').click();
    await expect(seat(page, 0, '1A')).toContainText('Aiman');
    await expect(seat(page, 0, '1A')).toHaveAttribute('data-state', 'vip');
  });
});
