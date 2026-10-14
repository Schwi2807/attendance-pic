import { test, expect, setupWithSample, goSeating, busCard, seat, unlockAdmin, row } from './helpers.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx-js-style');
const panelPeople = (page) => page.getByTestId('panel-list').getByTestId('person');

test.describe('Bus groups', () => {
  test.beforeEach(async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
  });

  test('tick people and put them on a bus; auto-fill seats them on that bus', async ({ page }) => {
    await page.getByTestId('select-mode').click();
    await expect(page.getByTestId('select-bar')).toBeVisible();
    for (let i = 0; i < 3; i++) await panelPeople(page).nth(i).click();
    await expect(page.getByTestId('picked-count')).toHaveText('3 selected');
    await page.getByTestId('pick-assign').click();
    await page.locator('.choice', { hasText: 'Bus Two' }).click();
    await expect(page.getByTestId('person-group')).toHaveCount(3);
    await expect(page.getByTestId('person-group').first()).toHaveText('Bus Two');
    await page.getByTestId('select-mode').click(); // done
    // Auto-fill: the three go to bus Two's front seats, everyone else fills from bus One
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('confirm-autofill').click();
    await expect(seat(page, 1, '1A')).toContainText('Aiman');
    await expect(seat(page, 1, '1B')).toContainText('Hajar');
    await expect(seat(page, 1, '1C')).toContainText('Wong');
    await expect(seat(page, 0, '1A')).toContainText('Danial');
  });

  test('select a whole group by searching any column, then shuffle randomly', async ({ page }) => {
    await page.getByTestId('select-mode').click();
    await page.getByTestId('panel-search').fill('G2'); // the "Group" column
    await expect(panelPeople(page)).toHaveCount(15);
    await page.getByTestId('pick-all').click();
    await expect(page.getByTestId('picked-count')).toHaveText('15 selected');
    await page.getByTestId('pick-random').click();
    await expect(page.locator('.toast', { hasText: 'Randomly grouped 15' })).toBeVisible();
    await expect(page.getByTestId('person-group')).toHaveCount(15);
  });

  test('random groups for everyone are balanced and shown in Attendance with a bus filter', async ({ page }) => {
    await page.getByTestId('bus-groups').click();
    await page.locator('.choice[data-value=random-new]').click();
    await expect(page.locator('.toast', { hasText: 'Randomly grouped 60: One 30 · Two 30' })).toBeVisible();
    await page.locator('[data-route=attendance]').click();
    await expect(row(page, 0).getByTestId('att-seat')).toHaveText(/^Bus (One|Two)$/);
    await page.getByTestId('bus-filter').selectOption({ label: 'Bus One' });
    await expect(page.getByTestId('att-row')).toHaveCount(30);
    await page.getByTestId('bus-filter').selectOption({ label: 'No bus yet' });
    await expect(page.getByTestId('att-row')).toHaveCount(0);
    // Undo removes the groups again
    await page.getByTestId('undo').click();
    await expect(page.getByTestId('att-row')).toHaveCount(60);
  });

  test('putting more people on a bus than it seats warns, and auto-fill leaves the rest waiting', async ({ page }) => {
    await page.getByTestId('select-mode').click();
    await page.getByTestId('pick-all').click();
    await page.getByTestId('pick-assign').click();
    await expect(page.locator('.choice', { hasText: 'Bus Two' })).toContainText('40 free seats left');
    await page.locator('.choice', { hasText: 'Bus Two' }).click();
    await expect(page.locator('.toast', { hasText: '60 people → Bus Two · 20 over capacity' })).toBeVisible();
    await page.getByTestId('select-mode').click();
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('confirm-autofill').click();
    await expect(busCard(page, 1).getByTestId('bus-summary')).toHaveText('Two — 40/40 seated');
    await expect(busCard(page, 0).getByTestId('bus-summary')).toHaveText('One — 0/40 seated');
    await expect(page.getByTestId('unseated-count')).toHaveText('20 unseated');
  });

  test('the bus group is exported in the Bus column even without a seat', async ({ page }, testInfo) => {
    await page.getByTestId('select-mode').click();
    await panelPeople(page).first().click();
    await page.getByTestId('pick-assign').click();
    await page.locator('.choice', { hasText: 'Bus Two' }).click();
    await page.getByTestId('open-export').click();
    await page.getByTestId('fmt-xlsx').click();
    await page.getByTestId('export-create').click();
    await page.locator('.choice[data-value=blank]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
    const path = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(path);
    const rows = XLSX.utils.sheet_to_json(XLSX.read(readFileSync(path)).Sheets.Attendance, { header: 1, defval: '' });
    expect(rows[1].slice(7, 9)).toEqual(['Two', '']); // Bus, Seat
    expect(rows[2].slice(7, 9)).toEqual(['', '']);
  });
});

test('people an admin seats in VIP / reserved seats count as seated', async ({ page }) => {
  await setupWithSample(page);
  await goSeating(page);
  await unlockAdmin(page);
  await seat(page, 0, '1A').click();
  await page.getByTestId('type-vip').click();
  await page.getByTestId('save-type').click();
  await expect(busCard(page, 0).getByTestId('bus-summary')).toHaveText('One — 0/39 seated · 1 VIP');
  await page.getByTestId('person').first().click();
  await seat(page, 0, '1A').click();
  await expect(seat(page, 0, '1A')).toContainText('Aiman');
  await expect(busCard(page, 0).getByTestId('bus-summary')).toHaveText('One — 1/40 seated · 1 VIP');
  // …and they no longer need a normal seat: 79 usable seats cover the other 59 people
  await expect(page.getByTestId('capacity')).toContainText('60 participants (1 in VIP/reserved seats) · 20 spare');
});
