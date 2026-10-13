import { test, expect, setupWithSample, row, goSeating, seat, unlockAdmin, busCard } from './helpers.js';

test('everything survives a reload (IndexedDB autosave)', async ({ page }) => {
  await setupWithSample(page);
  await row(page, 0).getByTestId('btn-present').click();
  await row(page, 1).getByTestId('btn-absent').click();
  await row(page, 2).locator('[data-act=remark]').click();
  await row(page, 2).getByTestId('remark-input').fill('Sick');
  await row(page, 2).getByTestId('remark-input').press('Enter');
  const time = await row(page, 0).getByTestId('att-time').textContent();

  await page.goto('./#/event');
  await page.getByTestId('ev-name').fill('Lawatan Industri FKAAB');
  await page.getByTestId('ev-venue').fill('Port Dickson');
  await page.getByTestId('ev-pic').fill('Aina');
  await page.getByTestId('ev-pic').blur();

  await goSeating(page);
  await page.getByTestId('person').first().click();
  await seat(page, 0, '3C').click();
  await unlockAdmin(page);
  await seat(page, 1, '1A').click();
  await page.getByTestId('type-vip').click();
  await page.getByTestId('type-label').fill('Dr. Ahmad');
  await page.getByTestId('save-type').click();
  await busCard(page, 1).getByTestId('flip-bus').click();
  await expect(page.getByTestId('save-state')).toContainText('Saved');

  await page.reload();
  await expect(page.getByTestId('brand-event')).toContainText('Lawatan Industri FKAAB');
  await expect(page.getByTestId('bus-card')).toHaveCount(2);
  await expect(seat(page, 0, '3C')).toContainText('Aiman');
  await expect(seat(page, 1, '1A')).toHaveAttribute('data-state', 'vip');
  await expect(seat(page, 1, '1A')).toContainText('Dr. Ahmad');
  await expect(busCard(page, 1).locator('svg.bus-svg')).toHaveAttribute('data-flipped', 'true');
  // admin mode is never restored after a reload
  await expect(page.getByTestId('admin-toggle')).toHaveAttribute('data-state', 'locked');

  await page.locator('[data-route=attendance]').click();
  await expect(page.getByTestId('counter')).toHaveAttribute('aria-label', '1 present, 1 absent, 58 unmarked of 60');
  await expect(row(page, 0).getByTestId('att-time')).toHaveText(time);
  await expect(row(page, 2).getByTestId('att-remark')).toHaveText('Sick');
  await expect(row(page, 0).getByTestId('att-seat')).toHaveText('One · 3C');

  await page.locator('[data-route=event]').click();
  await expect(page.getByTestId('ev-venue')).toHaveValue('Port Dickson');
  await expect(page.getByTestId('ev-pic')).toHaveValue('Aina');
});
