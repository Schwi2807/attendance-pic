// Minimal static server for local use and Playwright.
// Serves the app under /attendance-pic/ to mimic a GitHub Pages project site
// (https://<user>.github.io/<repo>/), so any absolute-path bug shows up here.
//
//   node tests/server.mjs            → http://localhost:4173/attendance-pic/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4173;
const BASE = '/attendance-pic/';
const MOUNTS = [
  [`${BASE}samples/`, join(root, 'samples')],
  [BASE, join(root, 'app')],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = decodeURIComponent(url.pathname);
  if (path === '/' || path === BASE.slice(0, -1)) {
    res.writeHead(302, { Location: BASE });
    return res.end();
  }
  const mount = MOUNTS.find(([prefix]) => path.startsWith(prefix));
  if (!mount) {
    res.writeHead(404);
    return res.end('Not found');
  }
  let file = normalize(join(mount[1], path.slice(mount[0].length)));
  if (!file.startsWith(mount[1])) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => console.log(`Attendance PIC: http://localhost:${PORT}${BASE}`));

