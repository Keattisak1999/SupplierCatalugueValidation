// Puts the SheetJS browser bundle in public/vendor so the site has no runtime CDN dependency.
// Uses node_modules/xlsx when installed, otherwise downloads the pinned release from the SheetJS CDN.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.20.3';
const CDN_URL = `https://cdn.sheetjs.com/xlsx-${VERSION}/package/dist/xlsx.full.min.js`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'vendor');
const out = join(outDir, 'xlsx.full.min.js');
const local = join(root, 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');

mkdirSync(outDir, { recursive: true });

if (existsSync(local)) {
  copyFileSync(local, out);
  console.log(`Copied ${local} -> public/vendor/xlsx.full.min.js`);
} else {
  console.log(`node_modules/xlsx not found, downloading ${CDN_URL}`);
  const res = await fetch(CDN_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length < 100_000 || !body.toString('utf8', 0, 2000).includes('SheetJS')) {
    throw new Error(`Downloaded file does not look like the SheetJS bundle (${body.length} bytes)`);
  }
  writeFileSync(out, body);
  console.log(`Downloaded SheetJS ${VERSION} (${body.length} bytes) -> public/vendor/xlsx.full.min.js`);
}
