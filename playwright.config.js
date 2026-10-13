// Playwright: iPad viewport. Runs on Chromium by default; set PW_WEBKIT=1
// (CI does) to also run the same suite on WebKit, Safari's engine.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT) || 4173;
const ipad = devices['iPad Pro 11 landscape'];

const projects = [
  {
    name: 'chromium-ipad',
    use: { ...ipad, browserName: 'chromium', defaultBrowserType: 'chromium' },
  },
];
if (process.env.PW_WEBKIT === '1') {
  projects.push({
    name: 'webkit-ipad',
    use: { ...ipad },
    // WebKit on GPU-less CI runners renders 3–8× slower than Chromium, so the
    // longest flows (painting 20+ seats, a full session with every export)
    // need more than 60 s. Same assertions, more time.
    timeout: 180_000,
    expect: { timeout: 20_000 },
  });
}

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 3 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/attendance-pic/`,
    acceptDownloads: true,
    // Animations are decorative; with reduced motion the app skips them, so
    // Playwright's "element is stable" checks never race a CSS transition.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    // Service workers are switched on only in the offline test.
    serviceWorkers: 'block',
  },
  projects,
  webServer: {
    command: 'node tests/server.mjs',
    url: `http://localhost:${PORT}/attendance-pic/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
