import { test, expect, openFresh, setupWithSample, pressPin, unlockAdmin, lockAdmin, goSeating, busCard, PIN } from './helpers.js';

test.describe('Admin mode', () => {
  test('PIN is required on first launch and cannot be skipped', async ({ page }) => {
    await page.goto('./');
    const pad = page.locator('.pin-overlay');
    await expect(pad).toBeVisible();
    await expect(pad).toContainText('Create an admin PIN');
    await expect(pad.locator('.ov-close')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(pad).toBeVisible();
    // mismatching confirmation starts over
    await pressPin(page, '1111');
    await page.locator('.pin-ok').click();
    await pressPin(page, '2222');
    await expect(pad).toContainText('PINs did not match');
    await pressPin(page, PIN);
    await page.locator('.pin-ok').click();
    await pressPin(page, PIN);
    await expect(pad).toHaveCount(0);
    // reload: no PIN prompt any more
    await page.reload();
    await expect(page.getByTestId('hero')).toBeVisible();
    await expect(page.locator('.pin-overlay')).toHaveCount(0);
  });

  test('unlock, ADMIN indicator, wrong PIN, manual lock', async ({ page }) => {
    await setupWithSample(page);
    const pill = page.getByTestId('admin-toggle');
    await expect(pill).toHaveAttribute('data-state', 'locked');
    await pill.click();
    await pressPin(page, '0000');
    await expect(page.locator('.pin-msg')).toContainText('Wrong PIN');
    await expect(pill).toHaveAttribute('data-state', 'locked');
    await pressPin(page, PIN);
    await expect(pill).toHaveAttribute('data-state', 'unlocked');
    await expect(pill).toContainText('ADMIN');
    await expect(page.locator('html')).toHaveClass(/is-admin/);
    await goSeating(page);
    await expect(busCard(page, 0).getByTestId('edit-bus')).toBeVisible();
    await lockAdmin(page);
    await expect(page.locator('html')).not.toHaveClass(/is-admin/);
    await expect(busCard(page, 0).getByTestId('edit-bus')).toBeHidden();
  });

  test('auto-locks after 5 minutes without interaction', async ({ page }) => {
    await page.clock.install();
    await setupWithSample(page);
    await unlockAdmin(page);
    await page.clock.fastForward('04:00');
    await expect(page.getByTestId('admin-toggle')).toHaveAttribute('data-state', 'unlocked');
    // any tap resets the idle timer
    await page.locator('[data-route=seating]').click();
    await page.clock.fastForward('04:00');
    await expect(page.getByTestId('admin-toggle')).toHaveAttribute('data-state', 'unlocked');
    await page.clock.fastForward('01:05');
    await expect(page.getByTestId('admin-toggle')).toHaveAttribute('data-state', 'locked');
    await expect(page.locator('.toast', { hasText: 'locked after 5 minutes' })).toBeVisible();
  });

  test('change PIN', async ({ page }) => {
    await openFresh(page);
    await page.goto('./#/event');
    await page.getByTestId('change-pin').click();
    await pressPin(page, PIN); // unlock first
    await pressPin(page, '135790');
    await page.locator('.pin-ok').click();
    await pressPin(page, '135790');
    await expect(page.locator('.toast', { hasText: 'PIN changed' })).toBeVisible();
    await lockAdmin(page);
    await page.getByTestId('admin-toggle').click();
    await pressPin(page, PIN); // the old 4-digit PIN no longer auto-submits (new one has 6)
    await page.keyboard.press('Enter');
    await expect(page.locator('.pin-msg')).toContainText('Wrong PIN');
    await page.keyboard.press('Escape');
    await unlockAdmin(page, '135790');
  });
});
