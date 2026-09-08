import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let _dirname;
try {
  if (typeof import.meta.dirname === 'string') {
    _dirname = import.meta.dirname;
  } else if (typeof import.meta.url === 'string') {
    _dirname = dirname(fileURLToPath(import.meta.url));
  } else {
    _dirname = process.cwd();
  }
} catch {
  try {
    _dirname = dirname(fileURLToPath(import.meta.url));
  } catch {
    _dirname = process.cwd();
  }
}

export const __dirname = _dirname;
export const __filename = join(_dirname, 'bundle.js');
