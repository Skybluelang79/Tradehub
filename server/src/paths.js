import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let _dirname;
try {
  if (typeof __dirname === 'string') {
    _dirname = __dirname;
  } else if (typeof import.meta.url === 'string') {
    _dirname = dirname(fileURLToPath(import.meta.url));
  } else {
    _dirname = process.cwd();
  }
} catch {
  _dirname = process.cwd();
}

export const __dirname = _dirname;
export const __filename = join(_dirname, 'bundle.js');
