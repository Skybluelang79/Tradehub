import { build } from 'vite';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

process.env.CF_PAGES = 'true';
process.env.VITE_BASE = '/';

await build();

const workerSrc = join(root, '_worker.js');
const workerOut = join(root, 'dist', '_worker.js');
mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(workerSrc, workerOut);
console.log(`Copied ${workerSrc} -> ${workerOut}`);