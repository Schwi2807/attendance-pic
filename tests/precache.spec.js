// Every file of the app must be in the service worker's pre-cache list,
// otherwise that file would be missing when the iPad is offline.
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const APP = join(process.cwd(), 'app');
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

test('service worker pre-caches every app file', () => {
  const sw = readFileSync(join(APP, 'sw.js'), 'utf8');
  const list = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
  const files = walk(APP).map((f) => relative(APP, f).split('\\').join('/')).filter((f) => f !== 'sw.js');
  const missing = files.filter((f) => !list.includes(f));
  expect(missing, 'files missing from PRECACHE in app/sw.js').toEqual([]);
  const extra = list.filter((f) => f && !files.includes(f) && !f.startsWith('samples/'));
  expect(extra, 'PRECACHE entries that do not exist').toEqual([]);
});
