// Copies the SheetJS browser bundle into public/vendor so the site has no runtime CDN dependency.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(dirname(require.resolve('xlsx/package.json')), 'dist', 'xlsx.full.min.js');
const outDir = join(root, 'public', 'vendor');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'xlsx.full.min.js'));
console.log(`Copied ${src} -> public/vendor/xlsx.full.min.js`);
