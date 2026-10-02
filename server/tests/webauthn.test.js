import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let db;
let token;
let userId;
const USER = { name: 'Passkey User', email: 'passkey-user@test.com', password: 'password123' };

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, 'webauthn-test.db');
  process.env.APP_URL = 'http://localhost:5173';
  process.env.RATE_LIMIT_DISABLED = 'true';
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch {}
  }

  const dbModule = await import('../db.js');
  await dbModule.ensureLoaded();
  db = dbModule.default;
  app = (await import('../app.js')).default;

  const signup = await supertest(app).post('/api/auth/signup').send(USER);
  token = signup.body.token;
  userId = signup.body.user.id;
}, 30000);

// Build a clientDataJSON blob carrying a given challenge, the same shape a
// browser would hand back.
function clientDataWithChallenge(challenge) {
  return Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost:5173', crossOrigin: false })
  ).toString('base64url');
}

describe('Passkey sign-in options', () => {
  it('issues a challenge when no email is supplied', async () => {
    const res = await supertest(app).post('/api/webauthn/login/options').send({});
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeTruthy();
    // No allowCredentials means the browser may offer any passkey for this site.
    expect(res.body.allowCredentials).toEqual([]);
    expect(res.body.userVerification).toBe('required');
  });

  it('requires user verification so a fingerprint or PIN is actually used', async () => {
    const res = await supertest(app).post('/api/webauthn/login/options').send({});
    expect(res.body.userVerification).toBe('required');
  });

  it('rejects a malformed email', async () => {
    const res = await supertest(app).post('/api/webauthn/login/options').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('records the issued challenge so it can be consumed exactly once', async () => {
    const res = await supertest(app).post('/api/webauthn/login/options').send({});
    const stored = db.prepare('SELECT * FROM webauthn_challenges WHERE challenge = ?').get(res.body.challenge);
    expect(stored).toBeTruthy();
    expect(stored.purpose).toBe('login');
  });
});

describe('Passkey authentication guards', () => {
  it('refuses a response carrying an unknown challenge', async () => {
    const res = await supertest(app)
      .post('/api/webauthn/login/verify')
      .send({
        id: 'made-up-credential',
        rawId: 'made-up-credential',
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataWithChallenge('a-challenge-we-never-issued'),
          authenticatorData: 'AAAA',
          signature: 'AAAA',
          userHandle: undefined,
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('refuses a response that omits clientDataJSON entirely', async () => {
    const res = await supertest(app)
      .post('/api/webauthn/login/verify')
      .send({ id: 'x', rawId: 'x', type: 'public-key', response: {} });
    expect(res.status).toBe(400);
  });

  it('refuses to sign in with a credential that was never registered', async () => {
    const options = await supertest(app).post('/api/webauthn/login/options').send({});
    const res = await supertest(app)
      .post('/api/webauthn/login/verify')
      .send({
        id: 'unregistered-credential-id',
        rawId: 'unregistered-credential-id',
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataWithChallenge(options.body.challenge),
          authenticatorData: 'AAAA',
          signature: 'AAAA',
        },
      });
    // The challenge is consumed, then the credential lookup fails.
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not registered/i);
  });

  it('burns a challenge so the same response cannot be replayed', async () => {
    const options = await supertest(app).post('/api/webauthn/login/options').send({});
    const payload = {
      id: 'unregistered-credential-id',
      rawId: 'unregistered-credential-id',
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataWithChallenge(options.body.challenge),
        authenticatorData: 'AAAA',
        signature: 'AAAA',
      },
    };
    await supertest(app).post('/api/webauthn/login/verify').send(payload);
    const replay = await supertest(app).post('/api/webauthn/login/verify').send(payload);
    expect(replay.status).toBe(400);
  });
});

describe('Passkey registration guards', () => {
  it('requires authentication to start registration', async () => {
    const res = await supertest(app).post('/api/webauthn/register/options').send({});
    expect(res.status).toBe(401);
  });

  it('issues registration options for the signed-in account', async () => {
    const res = await supertest(app)
      .post('/api/webauthn/register/options')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBeTruthy();
    expect(res.body.rp.id).toBe('localhost');
    expect(res.body.authenticatorSelection.userVerification).toBe('required');
    // Stable user handle so the browser recognises the same account.
    expect(res.body.user.id).toBe(Buffer.from(userId).toString('base64url'));
  });

  it('rejects a registration response signed against a foreign challenge', async () => {
    const res = await supertest(app)
      .post('/api/webauthn/register/verify')
      .set('Authorization', `Bearer ${token}`)
      .send({
        id: 'fake',
        rawId: 'fake',
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataWithChallenge('challenge-from-another-server'),
          attestationObject: 'AAAA',
        },
      });
    expect(res.status).toBe(400);
  });

  it('does not persist a credential when verification fails', async () => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM webauthn_credentials WHERE user_id = ?').get(userId).c;
    expect(count).toBe(0);
  });
});

describe('Passkey credential management', () => {
  it('starts with no passkeys', async () => {
    const res = await supertest(app)
      .get('/api/webauthn/credentials')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
  });

  it('refuses to list passkeys without a token', async () => {
    const res = await supertest(app).get('/api/webauthn/credentials');
    expect(res.status).toBe(401);
  });

  it('reports a missing credential as not found', async () => {
    const res = await supertest(app)
      .delete('/api/webauthn/credentials/does-not-exist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('will not delete another account passkey', async () => {
    db.prepare(`
      INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key)
      VALUES ('cred-1', 'someone-else', 'other-cred', 'AAAA')
    `).run();

    const res = await supertest(app)
      .delete('/api/webauthn/credentials/cred-1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS c FROM webauthn_credentials WHERE id = ?').get('cred-1').c).toBe(1);
  });
});