import { test, expect, openFresh, importFile, row, goSeating } from './helpers.js';
import { readFileSync } from 'node:fs';

test.describe('PWA / offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('works fully offline after the first visit (service worker cache)', async ({ page, context }) => {
    await openFresh(page);
    await page.waitForFunction(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg?.active && navigator.serviceWorker.controller);
    }, null, { timeout: 30_000 });
    await importFile(page, 'participants_sample.xlsx', { expectCount: 60 });

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/is-offline/);
    await expect(page.getByTestId('att-row')).toHaveCount(60);
    await row(page, 0).getByTestId('btn-present').click();
    await goSeating(page);
    await expect(page.getByTestId('bus-card')).toHaveCount(2);

    // Exports load their libraries from the cache, too.
    await page.getByTestId('open-export').click();
    await page.getByTestId('fmt-pdf').click();
    await page.getByTestId('pdf-seatmaps').check();
    await page.getByTestId('export-create').click();
    await page.locator('.choice[data-value=blank]').click();
    await expect(page.getByTestId('export-ready')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    await context.setOffline(false);
  });

  test('manifest is installable (name, icons, standalone, relative scope)', async ({ page, request }) => {
    await page.goto('./');
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    const manifest = await (await request.get(new URL(href, page.url()).href)).json();
    expect(manifest.name).toBe('Attendance PIC');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url.startsWith('./')).toBe(true);
    expect(manifest.scope).toBe('./');
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, page.url()).href);
      expect(res.ok()).toBe(true);
    }
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', 'icons/apple-touch-icon.png');
    await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
  });

  test('strict Content-Security-Policy is present', async ({ page }) => {
    await page.goto('./');
    const csp = await page.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
    for (const part of ["default-src 'self'", "connect-src 'self'", "img-src 'self' data: blob:", "script-src 'self'", "object-src 'none'"]) {
      expect(csp).toContain(part);
    }
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    const html = readFileSync('app/index.html', 'utf8');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/); // no inline scripts
    expect(html).not.toMatch(/\son[a-z]+=/i); // no inline event handlers
  });
});
