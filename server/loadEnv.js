import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

// import.meta.url is unavailable when esbuild bundles this file to CommonJS
// (Netlify/Vercel serverless functions), where fileURLToPath(undefined)
// throws at module load and takes the whole function down with a 502.
let here;
try {
  here = dirname(fileURLToPath(import.meta.url));
} catch {
  here = process.cwd();
}

// Resolve .env relative to this file, never process.cwd().
//
// The previous `import 'dotenv/config'` looked for .env in whatever directory
// the server was started from. Starting it from the repo root found no .env,
// so ADMIN_PASSWORD and JWT_SECRET silently fell back to the development
// defaults -- admin login stopped accepting the real password and started
// accepting "admin123" instead.
//
// dotenv does not override variables that are already set, so process
// environments (and the test suites, which assign process.env directly before
// importing) still win.
const result = dotenv.config({ path: join(here, '.env') });

if (result.error) {
  console.warn(
    `[env] ${join(here, '.env')} was not loaded (${result.error.code || result.error.message}). ` +
      'Using development defaults; set ADMIN_PASSWORD and JWT_SECRET before deploying.'
  );
}
