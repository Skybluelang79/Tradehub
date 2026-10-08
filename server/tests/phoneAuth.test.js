import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { normalizePhone } from '../src/sms.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
const userToken = {};
const USER = { name: 'Phone User', email: 'phone-user@test.com', password: 'password123' };

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, 'phoneauth-test.db');
  // These tests fire many codes in a row; the real 15-minute cap is exercised
  // separately, so switch it off here.
  process.env.RATE_LIMIT_DISABLED = 'true';
  // No SMS_API_KEY, so the server runs in dev mode and echoes the code back.
  delete process.env.SMS_API_KEY;
  process.env.OTP_PEPPER = 'test-otp-pepper';
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch {}
  }

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  const signup = await supertest(app).post('/api/auth/signup').send(USER);
  userToken.main = signup.body.token;
}, 30000);

async function requestCode(phone) {
  return supertest(app).post('/api/phone-auth/request-code').send({ phone });
}

async function linkPhone(token, phone) {
  const sent = await supertest(app)
    .post('/api/phone-auth/link')
    .set('Authorization', `Bearer ${token}`)
    .send({ phone });
  const confirmed = await supertest(app)
    .post('/api/phone-auth/link/verify')
    .set('Authorization', `Bearer ${token}`)
    .send({ phone, code: sent.body.devCode });
  return { sent, confirmed };
}

describe('Phone number normalisation', () => {
  it('strips formatting and a local trunk zero', () => {
    expect(normalizePhone('0803 123 4567')).toBe('8031234567');
    expect(normalizePhone('+234 803 123 4567')).toBe('2348031234567');
  });

  it('rejects input that cannot be a number', () => {
    expect(normalizePhone('abc')).toBe('');
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('123')).toBe('');
  });
});

describe('Phone sign-in', () => {
  it('accepts a malformed number as a validation error', async () => {
    const res = await requestCode('nope');
    expect(res.status).toBe(400);
  });

  it('answers the same way for an unknown number so accounts cannot be enumerated', async () => {
    const unknown = await requestCode('0809 999 9999');
    expect(unknown.status).toBe(200);
    expect(unknown.body.message).toMatch(/if that number is registered/i);
  });

  it('rejects a wrong code', async () => {
    const sent = await requestCode('0803 555 0001');
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
    const res = await supertest(app)
      .post('/api/phone-auth/verify')
      .send({ phone: '0803 555 0001', code: '000000' });
    expect(res.status).toBe(401);
  });

  it('burns an attempt per wrong code and locks the code out', async () => {
    const phone = '0803 555 0042';
    const sent = await requestCode(phone);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
    const wrong = sent.body.devCode === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const res = await supertest(app)
        .post('/api/phone-auth/verify')
        .send({ phone, code: wrong });
      expect(res.status).toBe(401);
    }

    // The code is burned: even the correct value is refused now.
    const locked = await supertest(app)
      .post('/api/phone-auth/verify')
      .send({ phone, code: sent.body.devCode });
    expect(locked.status).toBe(401);

    // A freshly issued code works again (404 because the number has no
    // account — the code itself was accepted).
    const fresh = await requestCode(phone);
    const ok = await supertest(app)
      .post('/api/phone-auth/verify')
      .send({ phone, code: fresh.body.devCode });
    expect(ok.status).toBe(404);
  });

  it('will not sign in a number that is not linked to any account', async () => {
    const sent = await requestCode('0809 888 7777');
    const res = await supertest(app)
      .post('/api/phone-auth/verify')
      .send({ phone: '0809 888 7777', code: sent.body.devCode });
    expect(res.status).toBe(404);
  });

  it('links a number and then signs in with it', async () => {
    const phone = '0803 123 4567';
    const { confirmed } = await linkPhone(userToken.main, phone);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.phoneVerified).toBe(true);

    const sent = await requestCode(phone);
    const res = await supertest(app)
      .post('/api/phone-auth/verify')
      .send({ phone, code: sent.body.devCode });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(USER.email);
    // The password must never come back through an auth response.
    expect(res.body.user.password).toBeUndefined();
  });

  it('refuses to link a number already owned by another account', async () => {
    const other = await supertest(app)
      .post('/api/auth/signup')
      .send({ name: 'Other', email: 'phone-other@test.com', password: 'password123' });
    const res = await supertest(app)
      .post('/api/phone-auth/link')
      .set('Authorization', `Bearer ${other.body.token}`)
      .send({ phone: '0803 123 4567' });
    expect(res.status).toBe(409);
  });

  it('requires authentication to link a number', async () => {
    const res = await supertest(app).post('/api/phone-auth/link').send({ phone: '0803 000 1111' });
    expect(res.status).toBe(401);
  });

  it('reports status and stops phone sign-in after unlinking', async () => {
    const status = await supertest(app)
      .get('/api/phone-auth/status')
      .set('Authorization', `Bearer ${userToken.main}`);
    expect(status.body.phoneVerified).toBe(true);

    const removed = await supertest(app)
      .delete('/api/phone-auth/link')
      .set('Authorization', `Bearer ${userToken.main}`);
    expect(removed.status).toBe(200);

    const after = await supertest(app)
      .get('/api/phone-auth/status')
      .set('Authorization', `Bearer ${userToken.main}`);
    expect(after.body.phoneVerified).toBe(false);
    expect(after.body.phone).toBe('');
  });
});

describe('Phone sign-up', () => {
  const phone = '0807 444 1111';

  async function requestSignupCode(number = phone) {
    return supertest(app).post('/api/phone-auth/signup/request-code').send({ phone: number });
  }

  it('rejects a malformed number as a validation error', async () => {
    const res = await requestSignupCode('nope');
    expect(res.status).toBe(400);
  });

  it('sends back a code in development', async () => {
    const sent = await requestSignupCode();
    expect(sent.status).toBe(200);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
    expect(sent.body.message).toMatch(/verification code/i);
  });

  it('rejects a wrong code', async () => {
    await requestSignupCode();
    const res = await supertest(app)
      .post('/api/phone-auth/signup/verify')
      .send({ phone, code: '000000', name: 'Test Person', username: 'test_person' });
    expect(res.status).toBe(401);
  });

  it('requires a name', async () => {
    const sent = await requestSignupCode();
    const res = await supertest(app)
      .post('/api/phone-auth/signup/verify')
      .send({ phone, code: sent.body.devCode, name: '', username: 'test_person' });
    expect(res.status).toBe(400);
  });

  it('creates a phone-verified account and lets it sign in by phone', async () => {
    const sent = await requestSignupCode();
    const created = await supertest(app)
      .post('/api/phone-auth/signup/verify')
      .send({ phone, code: sent.body.devCode, name: 'Mobile Native', username: 'mobile_native' });
    expect(created.status).toBe(201);
    expect(created.body.token).toBeTruthy();
    expect(created.body.refreshToken).toBeTruthy();
    expect(created.body.user.phone).toBe('8074441111');
    expect(created.body.user.password).toBeUndefined();

    const signinCode = await supertest(app)
      .post('/api/phone-auth/request-code')
      .send({ phone });
    expect(signinCode.status).toBe(200);
    const signin = await supertest(app)
      .post('/api/phone-auth/verify')
      .send({ phone, code: signinCode.body.devCode });
    expect(signin.status).toBe(200);
    expect(signin.body.user.email).toBe('phone-8074441111@users.tradehub.app');
  });

  it('will not issue a sign-up code for a number that already has an account', async () => {
    const res = await requestSignupCode();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already has a TradeHub account/i);
  });

  it('the same number cannot sign up twice even with a fresh code', async () => {
    // Codes for a taken number are still written so timing/shape stays
    // identical, but verify must refuse to mint a second account.
    const sent = await requestSignupCode();
    if (sent.status === 200 && sent.body.devCode) {
      const res = await supertest(app)
        .post('/api/phone-auth/signup/verify')
        .send({ phone, code: sent.body.devCode, name: 'Impostor', username: 'impostor_x' });
      expect([401, 409]).toContain(res.status);
    } else {
      expect(sent.status).toBe(409);
    }
  });
});