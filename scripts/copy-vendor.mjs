// Puts the browser bundles of SheetJS (reading files) and ExcelJS (writing the coloured output)
// in public/vendor so the site has no runtime CDN dependency.
// Each one is copied from node_modules when installed, otherwise downloaded from a pinned CDN URL.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBS = [
  {
    name: 'SheetJS 0.20.3',
    file: 'xlsx.full.min.js',
    local: 'node_modules/xlsx/dist/xlsx.full.min.js',
    url: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    marker: 'SheetJS',
  },
  {
    name: 'ExcelJS 4.4.0',
    file: 'exceljs.min.js',
    local: 'node_modules/exceljs/dist/exceljs.min.js',
    url: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    marker: 'ExcelJS',
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');
mkdirSync(outDir, { recursive: true });

for (const lib of LIBS) {
  const out = join(outDir, lib.file);
  const local = join(root, lib.local);
  if (existsSync(local)) {
    copyFileSync(local, out);
    console.log(`Copied ${lib.local} -> public/vendor/${lib.file}`);
    continue;
  }
  console.log(`${lib.local} not found, downloading ${lib.url}`);
  const res = await fetch(lib.url);
  if (!res.ok) throw new Error(`${lib.name} download failed: HTTP ${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 100_000 || !body.includes(lib.marker)) {
    throw new Error(`Downloaded file does not look like ${lib.name} (${body.length} bytes)`);
  }
  writeFileSync(out, body);
  console.log(`Downloaded ${lib.name} (${body.length} bytes) -> public/vendor/${lib.file}`);
}
