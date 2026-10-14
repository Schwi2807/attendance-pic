import { test, expect, setupWithSample, openFresh, row, goSeating, unlockAdmin, seat, pressPin } from './helpers.js';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx-js-style');
const NAME_RE = /^Attendance_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.(xlsx|csv|pdf|json)$/;

async function exportFile(page, testInfo, fmt, { unmarked = 'blank', seatMaps = false, table = true } = {}) {
  await page.getByTestId('open-export').click();
  await page.getByTestId(`fmt-${fmt}`).click();
  if (fmt === 'pdf') {
    if (seatMaps) await page.getByTestId('pdf-seatmaps').check();
    if (!table) await page.getByTestId('pdf-table').uncheck();
  }
  await page.getByTestId('export-create').click();
  if (fmt !== 'json' && unmarked) {
    const choice = page.locator(`.choice[data-value=${unmarked}]`);
    await choice.click();
  }
  await expect(page.getByTestId('export-ready')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const name = download.suggestedFilename();
  expect(name).toMatch(NAME_RE);
  const path = testInfo.outputPath(name);
  await download.saveAs(path);
  await page.keyboard.press('Escape');
  return { name, path, bytes: readFileSync(path) };
}

const pdfPages = (bytes) => (bytes.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
const pdfIsLandscape = (bytes) => /\/MediaBox \[0 0 841\.8\d* 595\.2\d*\]/.test(bytes.toString('latin1'));

test.describe('Exports', () => {
  test.beforeEach(async ({ page }) => {
    test.slow(); // PDF generation of several files
    await setupWithSample(page);
    await page.goto('./#/event');
    await page.getByTestId('ev-name').fill('Lawatan Industri');
    await page.getByTestId('ev-date').fill('2026-11-02');
    await page.getByTestId('ev-date').blur();
    await page.locator('[data-route=attendance]').click();
    for (let i = 0; i < 5; i++) await row(page, i).getByTestId('btn-present').click();
    await row(page, 5).getByTestId('btn-absent').click();
    await row(page, 6).getByTestId('btn-absent').click();
    await goSeating(page);
    await page.getByTestId('auto-fill').click();
    await page.getByTestId('skip-absent').uncheck();
    await page.getByTestId('confirm-autofill').click();
  });

  test('XLSX: original columns + app columns, Absent rows filled #FDE2E2', async ({ page }, testInfo) => {
    const { name, bytes } = await exportFile(page, testInfo, 'xlsx', { unmarked: 'blank' });
    expect(name).toBe('Attendance_Lawatan_Industri_2026-11-02.xlsx');
    const wb = XLSX.read(bytes, { cellStyles: true });
    expect(wb.SheetNames).toEqual(['Attendance', 'Event']);
    const ws = wb.Sheets.Attendance;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    // The imported "Remarks" column is managed by the app → not duplicated
    expect(rows[0]).toEqual(['No', 'Name', 'Matric No', 'Programme', 'Group', 'Phone', 'Present', 'Bus', 'Seat', 'Remarks', 'Check-in Time']);
    expect(rows).toHaveLength(61);
    expect(rows[1].slice(1, 3)).toEqual(['Aiman bin Rahman', 'AD250001']);
    expect(rows[1].slice(6, 9)).toEqual(['Present', 'One', '1A']);
    expect(rows[1][10]).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}$/); // "13 Oct 2026, 08:15"
    expect(rows[6].slice(6, 9)).toEqual(['Absent', 'One', '2B']);
    expect(rows[6][10]).toBe(''); // no check-in time for absentees
    expect(rows[5][9]).toBe('Vegetarian meal');
    expect(rows[10][6]).toBe(''); // unmarked left blank
    for (let c = 0; c < 11; c++) {
      const absent = ws[XLSX.utils.encode_cell({ r: 6, c })];
      expect(absent.s?.fgColor?.rgb ?? absent.s?.fill?.fgColor?.rgb).toBe('FDE2E2');
      const present = ws[XLSX.utils.encode_cell({ r: 1, c })];
      expect(present.s?.patternType ?? 'none').toBe('none');
    }
  });

  test('unmarked rows can be marked Absent before export', async ({ page }, testInfo) => {
    const { bytes } = await exportFile(page, testInfo, 'csv', { unmarked: 'absent' });
    const lines = bytes.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(61);
    const present = lines.slice(1).map((l) => l.split(',')[6]);
    expect(present.filter((p) => p === 'Present')).toHaveLength(5);
    expect(present.filter((p) => p === 'Absent')).toHaveLength(55);
    await page.locator('[data-route=attendance]').click();
    await expect(page.getByTestId('counter')).toHaveAttribute('aria-label', '5 present, 55 absent, 0 unmarked of 60');
  });

  test('CSV: UTF-8 BOM, header and values', async ({ page }, testInfo) => {
    const { bytes } = await exportFile(page, testInfo, 'csv');
    const text = bytes.toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('No,Name,Matric No,Programme,Group,Phone,Present,Bus,Seat,Remarks,Check-in Time');
    // The time stamp contains a comma, so CSV quotes it.
    expect(lines[1]).toMatch(/^1,Aiman bin Rahman,AD250001,Civil Engineering,G1,012-555 1000,Present,One,1A,,"\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}"$/);
    expect(lines[6]).toMatch(/,Absent,One,2B,,$/);
  });

  test('PDF: attendance table only (landscape for 11 columns, page numbers)', async ({ page }, testInfo) => {
    const { bytes } = await exportFile(page, testInfo, 'pdf');
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfIsLandscape(bytes)).toBe(true);
    const pages = pdfPages(bytes);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pages).toBeLessThanOrEqual(4);
  });

  test('PDF: table + seat maps adds one page per deck', async ({ page }, testInfo) => {
    const tableOnly = pdfPages((await exportFile(page, testInfo, 'pdf')).bytes);
    const withMaps = pdfPages((await exportFile(page, testInfo, 'pdf', { seatMaps: true })).bytes);
    expect(withMaps).toBe(tableOnly + 2); // two single-deck buses
    // make bus One a double-decker → three decks
    await unlockAdmin(page);
    await page.getByTestId('bus-card').first().getByTestId('edit-bus').click();
    await page.getByTestId('deck-double').click();
    await page.getByTestId('save-layout').click();
    // Bus One alone now fits everyone; keep bus Two (it has passengers).
    await expect(page.locator('.ov-panel.is-danger')).toContainText('Remove bus Two?');
    await page.locator('[data-action=cancel]').click();
    await expect(seat(page, 0, 'U1A')).toHaveCount(1);
    await expect(page.getByTestId('bus-card')).toHaveCount(2);
    const mapsOnly = pdfPages((await exportFile(page, testInfo, 'pdf', { seatMaps: true, table: false })).bytes);
    expect(mapsOnly).toBe(3);
  });

  test('JSON backup + admin-only restore on a fresh device', async ({ page, browser }, testInfo) => {
    const { bytes, path } = await exportFile(page, testInfo, 'json');
    const snap = JSON.parse(bytes.toString('utf8'));
    expect(snap.format).toBe('attendance-pic/backup');
    expect(snap.participants).toHaveLength(60);
    expect(snap.buses).toHaveLength(2);
    expect(snap.sessions[0].assignments).toHaveLength(60);

    // A brand-new browser profile = a different iPad
    const ctx2 = await browser.newContext({ viewport: page.viewportSize(), hasTouch: true, serviceWorkers: 'block', baseURL: new URL('./', page.url()).href });
    const p2 = await ctx2.newPage();
    await openFresh(p2, '4321');
    await p2.goto('./#/event');
    await p2.getByTestId('backup-restore').click();
    await pressPin(p2, '4321'); // restore is admin-only
    await p2.getByTestId('restore-input').setInputFiles(path);
    await expect(p2.getByRole('dialog', { name: 'Restore “Lawatan Industri”?' })).toBeVisible();
    await p2.locator('[data-action=ok]').click();
    await expect(p2.getByTestId('brand-event')).toContainText('Lawatan Industri');
    await p2.locator('[data-route=attendance]').click();
    await expect(p2.getByTestId('counter')).toHaveAttribute('aria-label', '5 present, 2 absent, 53 unmarked of 60');
    await p2.locator('[data-route=seating]').click();
    await expect(p2.getByTestId('unseated-count')).toHaveText('0 unseated');
    await ctx2.close();
  });
});
