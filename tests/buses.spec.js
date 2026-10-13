import { test, expect, setupWithSample, unlockAdmin, lockAdmin, goSeating, busCard, seat, expectSeats, openLayout, importFile, openFresh, csvFile } from './helpers.js';

const letters = async (page, busIndex) => {
  const labels = await busCard(page, busIndex).locator('.seat').evaluateAll((els) => els.map((e) => e.dataset.seatLabel));
  return [...new Set(labels.map((l) => l.replace(/^[LU]?\d+/, '')))].sort().join('');
};

test.describe('Buses', () => {
  test('auto bus count: 60 participants → 2 buses of 40 (default 2-2 × 10)', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await expect(page.getByTestId('bus-card')).toHaveCount(2);
    await expect(page.getByTestId('bus-title')).toHaveText(['One', 'Two']);
    await expect(page.getByTestId('bus-count')).toContainText('2 buses · 80 usable seats');
    await expectSeats(page, 0, 40);
    await expect(busCard(page, 0).getByTestId('bus-summary')).toHaveText('One — 0/40 seated');
  });

  test('a small list needs only one bus', async ({ page }) => {
    await openFresh(page);
    const rows = Array.from({ length: 12 }, (_, i) => `Person ${i + 1},ZZ${1000 + i}`).join('\n');
    await importFile(page, csvFile('twelve.csv', `Name,ID\n${rows}\n`));
    await goSeating(page);
    await expect(page.getByTestId('bus-card')).toHaveCount(1);
  });

  for (const [layout, count, expected] of [
    ['2-2', 40, 'ABCD'],
    ['2-3', 50, 'ABCDE'],
    ['1-2', 30, 'ABC'],
    ['1-3', 40, 'ABCD'],
  ]) {
    test(`layout ${layout}: ${count} seats, letters ${expected}`, async ({ page }) => {
      await setupWithSample(page);
      await goSeating(page);
      await unlockAdmin(page);
      await openLayout(page, 0);
      await page.getByTestId(`layout-L-${layout}`).click();
      await expect(page.getByTestId('preview-seats')).toHaveText(`${count} seats`);
      await page.getByTestId('save-layout').click();
      await expect(page.getByTestId('layout-editor')).toHaveCount(0);
      await expectSeats(page, 0, count);
      expect(await letters(page, 0)).toBe(expected);
      await expect(busCard(page, 0)).toContainText(`Single deck · ${layout} × 10`);
    });
  }

  test('full back bench adds the aisle seat on the last row', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await unlockAdmin(page);
    await openLayout(page, 0);
    await page.getByTestId('bench-L').click();
    await expect(page.getByTestId('preview-seats')).toHaveText('41 seats');
    await page.getByTestId('save-layout').click();
    await expectSeats(page, 0, 41);
    await expect(seat(page, 0, '10E')).toHaveCount(1);
    await expect(seat(page, 0, '9E')).toHaveCount(0);
    // Bench seats are spread across the full width: 10C sits in the aisle.
    const b = await seat(page, 0, '10B').boundingBox();
    const c = await seat(page, 0, '10C').boundingBox();
    const d = await seat(page, 0, '10D').boundingBox();
    expect(c.y).toBeLessThan(b.y);
    expect(c.y).toBeGreaterThan(d.y);
  });

  test('double-decker: lower deck with driver, both decks with stairs, L/U prefixes', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await unlockAdmin(page);
    await openLayout(page, 0);
    await page.getByTestId('deck-double').click();
    await page.getByTestId('layout-L-1-2').click();
    for (let i = 0; i < 6; i++) await page.getByTestId('rows-L-minus').click();
    await expect(page.getByTestId('rows-L')).toHaveText('4');
    await expect(page.getByTestId('preview-seats')).toHaveText('52 seats');
    await page.getByTestId('save-layout').click();
    const card = busCard(page, 0);
    await expect(card.locator('svg.bus-svg')).toHaveAttribute('data-decks', '2');
    await expect(card.locator('.deck-title')).toHaveText(['LOWER DECK', 'UPPER DECK']);
    await expect(card.locator('.deck--L .bus-driver')).toHaveCount(1);
    await expect(card.locator('.deck--U .bus-driver')).toHaveCount(0);
    await expect(card.locator('.deck--L .bus-stairs')).toHaveCount(1);
    await expect(card.locator('.deck--U .bus-stairs')).toHaveCount(1);
    await expect(seat(page, 0, 'L1A')).toHaveCount(1);
    await expect(seat(page, 0, 'U10D')).toHaveCount(1);
    await expect(seat(page, 0, 'L5A')).toHaveCount(0);
    await expectSeats(page, 0, 52);
    // stairs at the same position on both decks
    const sl = await card.locator('.deck--L .bus-stairs').boundingBox();
    const su = await card.locator('.deck--U .bus-stairs').boundingBox();
    expect(Math.abs(sl.x - su.x)).toBeLessThan(1);
  });

  test('flip facing direction', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    const svg = busCard(page, 0).locator('svg.bus-svg');
    await expect(svg).toHaveAttribute('data-flipped', 'false');
    let a = await seat(page, 0, '1A').boundingBox();
    let z = await seat(page, 0, '10A').boundingBox();
    expect(a.x).toBeLessThan(z.x); // nose on the left
    await busCard(page, 0).getByTestId('flip-bus').click();
    await expect(svg).toHaveAttribute('data-flipped', 'true');
    a = await seat(page, 0, '1A').boundingBox();
    z = await seat(page, 0, '10A').boundingBox();
    const d = await seat(page, 0, '1D').boundingBox();
    expect(a.x).toBeGreaterThan(z.x); // nose on the right
    expect(a.y).toBeLessThan(d.y); // turned 180°, so A is now on top
    // the other bus is unaffected
    await expect(busCard(page, 1).locator('svg.bus-svg')).toHaveAttribute('data-flipped', 'false');
  });

  test('seat types reduce capacity and the bus count follows', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await unlockAdmin(page);
    await page.getByTestId('paint-types').click();
    await page.getByTestId('paint-unavailable').click();
    const labels = [];
    for (let r = 1; r <= 5; r++) for (const l of 'ABCD') labels.push(`${r}${l}`);
    for (const l of labels) await seat(page, 1, l).click(); // 20 unavailable → 60 usable, still enough
    await expect(page.getByTestId('bus-card')).toHaveCount(2);
    await page.getByTestId('paint-reserved').click();
    await seat(page, 1, '6A').click(); // 59 usable → a third bus is added
    await expect(page.getByTestId('bus-card')).toHaveCount(3);
    await expect(page.getByTestId('bus-title').nth(2)).toHaveText('Three');
    await expect(busCard(page, 1).getByTestId('bus-summary')).toHaveText('Two — 0/19 seated · 1 reserved · 20 unavailable');
    // undo the reserved seat → the empty third bus is removed again
    await seat(page, 1, '6A').click();
    await expect(page.getByTestId('bus-card')).toHaveCount(2);
    await page.getByTestId('paint-done').click();
    // VIP via the seat sheet, with a label
    await seat(page, 0, '1A').click();
    await page.getByTestId('type-vip').click();
    await page.getByTestId('type-label').fill('Dr. Ahmad');
    await page.getByTestId('save-type').click();
    await expect(seat(page, 0, '1A')).toHaveAttribute('data-state', 'vip');
    await expect(seat(page, 0, '1A')).toContainText('Dr. Ahmad');
    await expect(page.getByTestId('bus-card')).toHaveCount(3);
    await expect(busCard(page, 0).getByTestId('bus-summary')).toHaveText('One — 0/39 seated · 1 VIP');
  });

  test('non-admin cannot set seat types', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await expect(page.getByTestId('paint-types')).toBeHidden();
    await expect(busCard(page, 0).getByTestId('edit-bus')).toBeHidden();
    await seat(page, 0, '2B').click();
    await expect(page.getByTestId('seat-sheet')).toBeVisible();
    await expect(page.getByTestId('type-grid')).toHaveCount(0);
    await page.keyboard.press('Escape');
    // Admin marks a reserved seat, then locks
    await unlockAdmin(page);
    await seat(page, 0, '2B').click();
    await page.getByTestId('type-reserved').click();
    await page.getByTestId('type-label').fill('Guide');
    await page.getByTestId('save-type').click();
    await lockAdmin(page);
    await seat(page, 0, '2B').click();
    await expect(page.getByTestId('seat-sheet')).toContainText('Only an admin can seat someone here');
    await expect(page.getByTestId('picker-list')).toHaveCount(0);
    await expect(page.getByTestId('type-grid')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(seat(page, 0, '2B')).toHaveAttribute('data-state', 'reserved');
  });

  test('admin can add, rename and remove buses (manual mode)', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await unlockAdmin(page);
    await page.getByTestId('manage-buses').click();
    await page.locator('.choice[data-value=add]').click();
    await expect(page.getByTestId('bus-card')).toHaveCount(3);
    await expect(page.getByTestId('bus-count')).toContainText('3 buses');
    await busCard(page, 2).getByTestId('bus-more').click();
    await page.locator('.choice[data-value=rename]').click();
    await page.locator('.ov-panel input.input').fill('Bas Merah');
    await page.locator('.ov-panel button[type=submit]').click();
    await expect(page.getByTestId('bus-title').nth(2)).toHaveText('Bas Merah');
    await busCard(page, 2).getByTestId('bus-more').click();
    await page.locator('.choice[data-value=remove]').click();
    await page.locator('[data-action=ok]').click();
    await expect(page.getByTestId('bus-card')).toHaveCount(2);
    await expect(page.locator('.cap-summary')).toContainText('manual bus count');
  });

  test('warns before a recompute removes a bus with passengers', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('confirm-autofill').click();
    await expect(busCard(page, 1).getByTestId('bus-summary')).toHaveText('Two — 20/40 seated');
    await unlockAdmin(page);
    await openLayout(page, 0);
    for (let i = 0; i < 5; i++) await page.getByTestId('rows-L-plus').click(); // 15 rows = 60 seats
    await page.getByTestId('save-layout').click();
    // Bus One alone now fits everyone, but Two has passengers → ask first
    await expect(page.locator('.ov-panel.is-danger')).toContainText('Remove bus Two?');
    await page.locator('[data-action=cancel]').click(); // keep bus (manual mode)
    await expect(page.getByTestId('bus-card')).toHaveCount(2);
    await expect(busCard(page, 1).getByTestId('bus-summary')).toHaveText('Two — 20/40 seated');
    await expect(page.locator('.cap-summary')).toContainText('manual bus count');
  });

  test('warns before a layout change removes seats with passengers', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('confirm-autofill').click();
    await unlockAdmin(page);
    await openLayout(page, 0);
    await page.getByTestId('rows-L-minus').click(); // row 10 has 4 passengers
    await page.getByTestId('save-layout').click();
    await expect(page.locator('.ov-panel.is-danger')).toContainText('4 seated passenger(s) would lose their seat');
    await page.locator('[data-action=cancel]').click();
    await expectSeats(page, 0, 40);
  });

  test('default template is used for buses added automatically', async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
    await unlockAdmin(page);
    await page.getByTestId('manage-buses').click();
    await page.locator('.choice[data-value=template]').click();
    await page.getByTestId('layout-L-2-3').click();
    await page.getByTestId('save-layout').click();
    // make bus Two unusable enough that a third bus is needed
    await page.getByTestId('paint-types').click();
    for (const r of [1, 2, 3, 4, 5, 6]) for (const l of 'ABCD') await seat(page, 1, `${r}${l}`).click();
    await expect(page.getByTestId('bus-card')).toHaveCount(3);
    await expect(busCard(page, 2)).toContainText('2-3 × 10');
    await expectSeats(page, 2, 50);
  });
});
