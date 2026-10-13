import { test, expect, setupWithSample, goSeating, seat } from './helpers.js';

// Sample participant #1: Aiman bin Rahman · AD250001 · 012-555 1000
//                    #2: Siti Hajar binti Ismail · AD250002 · 012-555 1037
const panelPeople = (page) => page.getByTestId('panel-list').getByTestId('person');

test.describe('Phone numbers in the Seating tab', () => {
  test.beforeEach(async ({ page }) => {
    await setupWithSample(page);
    await goSeating(page);
  });

  test('shown next to the ID in the participants panel and searchable', async ({ page }) => {
    const first = panelPeople(page).first();
    await expect(first.getByTestId('person-id')).toHaveText('AD250001');
    await expect(first.getByTestId('person-phone')).toHaveText('012-555 1000');
    // digits-only search finds the formatted number
    await page.getByTestId('panel-search').fill('0125551037');
    await expect(panelPeople(page)).toHaveCount(1);
    await expect(panelPeople(page).first()).toContainText('Siti Hajar binti Ismail');
  });

  test('seat sheet shows a tap-to-call link; the picker shows phones too', async ({ page }) => {
    await panelPeople(page).first().click();
    await seat(page, 0, '1A').click();
    await seat(page, 0, '1A').click();
    await expect(page.getByTestId('sheet-phone')).toHaveText('012-555 1000');
    await expect(page.getByTestId('sheet-phone')).toHaveAttribute('href', 'tel:0125551000');
    await page.keyboard.press('Escape');
    await seat(page, 0, '1B').click();
    await expect(page.getByTestId('picker-list').getByTestId('person-phone').first()).toHaveText('012-555 1037');
  });

  test('masked together with IDs when "Mask IDs and phone numbers" is on', async ({ page }) => {
    await page.goto('./#/event');
    await page.getByTestId('mask-toggle').click();
    await goSeating(page);
    const first = panelPeople(page).first();
    await expect(first.getByTestId('person-id')).toHaveText('AD••••••');
    await expect(first.getByTestId('person-phone')).toHaveText('012-••• ••00');
  });

  test('the phone column can be changed or turned off in the Event tab', async ({ page }) => {
    await page.goto('./#/event');
    await expect(page.getByTestId('ev-phone')).toHaveValue('Phone');
    await page.getByTestId('ev-phone').selectOption('');
    await goSeating(page);
    await expect(panelPeople(page).first().getByTestId('person-phone')).toHaveCount(0);
    await page.goto('./#/event');
    await page.getByTestId('ev-phone').selectOption('Phone');
    await goSeating(page);
    await expect(panelPeople(page).first().getByTestId('person-phone')).toHaveText('012-555 1000');
  });
});
