import { test, expect, openFresh, importFile, setupWithSample, csvFile, row } from './helpers.js';

test.describe('Import', () => {
  test('xlsx: 60 participants, Name/ID auto-mapped, Remarks column reused', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('hero-import').click();
    await page.getByTestId('file-input').setInputFiles('samples/participants_sample.xlsx');
    await expect(page.getByTestId('import-count')).toHaveText('60 participants');
    await expect(page.getByTestId('map-name')).toHaveValue('Name');
    await expect(page.getByTestId('map-id')).toHaveValue('Matric No');
    await expect(page.getByTestId('map-phone')).toHaveValue('Phone');
    await expect(page.getByTestId('reused-notice')).toContainText('Remarks');
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('att-row')).toHaveCount(60);
    await expect(row(page, 0).getByTestId('att-name')).toHaveText('Aiman bin Rahman');
    await expect(row(page, 0).getByTestId('att-id')).toHaveText('AD250001');
    // Reused "Remarks" value from the spreadsheet
    await expect(row(page, 4).getByTestId('att-remark')).toHaveText('Vegetarian meal');
    await expect(page.getByTestId('counter')).toHaveAttribute('aria-label', '0 present, 0 absent, 60 unmarked of 60');
  });

  test('csv (comma) import', async ({ page }) => {
    await openFresh(page);
    await importFile(page, 'participants_sample.csv', { expectCount: 60 });
    await expect(page.getByTestId('att-row')).toHaveCount(60);
    await expect(row(page, 59).getByTestId('att-id')).toHaveText('AD250060');
  });

  test('txt (tab-delimited) import', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('hero-import').click();
    await page.getByTestId('file-input').setInputFiles('samples/participants_sample.txt');
    await expect(page.getByTestId('import-count')).toHaveText('60 participants');
    await expect(page.locator('.import-flow')).toContainText('Tab-separated');
    await page.getByTestId('confirm-import').click();
    await expect(page.getByTestId('att-row')).toHaveCount(60);
  });

  test('semicolon delimiter, quoted fields, duplicate IDs and empty rows are reported', async ({ page }) => {
    await openFresh(page);
    await page.getByTestId('hero-import').click();
    const text = [
      'Nama;No. Matrik;Fakulti;Present',
      '"Ali; bin Abu";AB100001;FKAAB;Yes',
      ';;;',
      'Siti Aminah;AB100002;FPTV;',
      'Chong Wei;AB100001;FSKTM;absent',
      '',
      'Raju a/l Muthu;AB100004;FKMP;',
    ].join('\n');
    await page.getByTestId('file-input').setInputFiles(csvFile('list.csv', text));
    await expect(page.getByTestId('import-count')).toHaveText('4 participants');
    await expect(page.getByTestId('map-name')).toHaveValue('Nama');
    await expect(page.getByTestId('map-id')).toHaveValue('No. Matrik');
    const warn = page.getByTestId('import-warnings');
    await expect(warn).toContainText('1 duplicate ID');
    await expect(warn).toContainText('AB100001');
    await expect(warn).toContainText('2 empty rows');
    await expect(page.getByTestId('reused-notice')).toContainText('Present');
    await page.getByTestId('confirm-import').click();
    // Duplicate IDs need an explicit confirmation
    await page.locator('[data-action=ok]').click();
    await expect(page.getByTestId('att-row')).toHaveCount(4);
    await expect(row(page, 0).getByTestId('att-name')).toHaveText('Ali; bin Abu');
    // Reused Present column: Yes → present, absent → absent
    await expect(row(page, 0)).toHaveAttribute('data-status', 'present');
    await expect(row(page, 2)).toHaveAttribute('data-status', 'absent');
    await expect(row(page, 1)).toHaveAttribute('data-status', 'unmarked');
  });

  test('re-importing replaces the list of the current event when chosen', async ({ page }) => {
    await setupWithSample(page);
    await page.goto('./#/event');
    await page.getByTestId('ev-import').click();
    await page.getByTestId('file-input').setInputFiles(csvFile('small.csv', 'Name,ID\nA One,X1\nB Two,X2\n'));
    await page.locator('[data-mode=replace]').click();
    await page.getByTestId('confirm-import').click();
    await page.locator('[data-action=ok]').click();
    await expect(page.getByTestId('att-row')).toHaveCount(2);
    // The original event is gone from the list only if replaced, not duplicated
    await page.goto('./#/event');
    await expect(page.getByTestId('event-list').locator('.event-item')).toHaveCount(1);
  });
});
