// Copies the third-party browser bundles from node_modules into app/vendor.
// The app never loads anything from a CDN: these files are served from the
// same origin and pre-cached by the service worker.
//
//   npm install && npm run vendor
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app', 'vendor');
mkdirSync(out, { recursive: true });

const files = [
  ['xlsx-js-style', 'dist/xlsx.bundle.js', 'xlsx.bundle.js', 'LICENSE'],
  ['jspdf', 'dist/jspdf.umd.min.js', 'jspdf.umd.min.js', 'LICENSE'],
  ['jspdf-autotable', 'dist/jspdf.plugin.autotable.min.js', 'jspdf.plugin.autotable.min.js', 'LICENSE.txt'],
];

let licenses = '# Third-party licenses\n\nThese libraries are vendored unmodified from npm.\n';
for (const [pkg, src, dest, lic] of files) {
  const base = join(root, 'node_modules', pkg);
  const { version, license } = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'));
  copyFileSync(join(base, src), join(out, dest));
  licenses += `\n## ${pkg} ${version} (${license})\n\nFile: \`${dest}\`\n\n\`\`\`\n${readFileSync(join(base, lic), 'utf8').trim()}\n\`\`\`\n`;
  console.log(`vendored ${pkg}@${version} -> app/vendor/${dest}`);
}
writeFileSync(join(out, 'LICENSES.md'), licenses);
