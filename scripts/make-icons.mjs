// Renders the app icon (SVG) to the PNG sizes iOS / Android / browsers need.
//   npm run icons
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app', 'icons');

// Seat-map tile with a check mark. `pad` shrinks the art for maskable icons.
const svg = ({ rounded = true, pad = 0 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4F6BFF"/><stop offset="1" stop-color="#7C3AED"/></linearGradient>
    <radialGradient id="shine" cx="0.25" cy="0.15" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#g)"/>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#shine)"/>
  <g transform="translate(${pad} ${pad}) scale(${(512 - pad * 2) / 512})">
    <rect x="96" y="118" width="320" height="214" rx="54" fill="#fff" opacity=".16"/>
    <g fill="#fff">
      <rect x="128" y="148" width="62" height="62" rx="16"/><rect x="210" y="148" width="62" height="62" rx="16" opacity=".5"/><rect x="322" y="148" width="62" height="62" rx="16" opacity=".5"/>
      <rect x="128" y="240" width="62" height="62" rx="16" opacity=".5"/><rect x="210" y="240" width="62" height="62" rx="16"/><rect x="322" y="240" width="62" height="62" rx="16"/>
    </g>
    <path d="m160 392 44 38 148-74" fill="none" stroke="#fff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

writeFileSync(join(out, 'icon.svg'), svg());
const targets = [
  ['icon-192.png', 192, { rounded: true }],
  ['icon-512.png', 512, { rounded: true }],
  ['maskable-512.png', 512, { rounded: false, pad: 60 }],
  ['apple-touch-icon.png', 180, { rounded: false }],
  ['favicon-32.png', 32, { rounded: true }],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, opts] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(opts).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', name);
}
await browser.close();
