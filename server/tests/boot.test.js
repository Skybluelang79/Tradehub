import { describe, it, expect } from '@jest/globals';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The server is bundled and run as a single function on Netlify, so a module
 * that throws at import time takes down every route in the app, not just its
 * own. A missing OTP_PEPPER used to do exactly that: the phone routes were
 * reachable and the whole site answered 502. These run in a child process
 * with a clean environment because module caching would hide the difference.
 */
async function bootsWith(env) {
  try {
    await execFileAsync(process.execPath, ['-e', "import('./app.js').then(()=>process.exit(0)).catch(()=>process.exit(1))"], {
      cwd: join(__dirname, '..'),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'production',
        JWT_SECRET: 'a-real-jwt-secret',
        REFRESH_SECRET: 'a-real-refresh-secret',
        DB_PATH: join(__dirname, 'boot-test.db'),
        ...env,
      },
    });
    return true;
  } catch {
    return false;
  }
}

describe('Server boot in production', () => {
  it('starts without SMS_API_KEY, since phone sign-in is optional', async () => {
    expect(await bootsWith({})).toBe(true);
  }, 60000);

  it('starts without OTP_PEPPER, deriving it from JWT_SECRET', async () => {
    expect(await bootsWith({ OTP_PEPPER: '' })).toBe(true);
  }, 60000);

  it('starts with OTP_PEPPER set explicitly', async () => {
    expect(await bootsWith({ OTP_PEPPER: 'pepper' })).toBe(true);
  }, 60000);

  it('still refuses to start without JWT_SECRET', async () => {
    expect(await bootsWith({ JWT_SECRET: '' })).toBe(false);
  }, 60000);
});
