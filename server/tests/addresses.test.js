import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let ownerToken;
let otherToken;
let firstAddress;
let secondAddress;

const run = Date.now();

async function signup(name, email) {
  const res = await supertest(app)
    .post('/api/auth/signup')
    .send({ name, email, password: 'password123' });
  if (res.body.token) return res.body.token;
  const login = await supertest(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' });
  return login.body.token;
}

function addressPayload(overrides = {}) {
  return {
    label: 'Home',
    full_name: 'Address Owner',
    phone: '+2348000000000',
    line1: '1 Test Street',
    line2: 'Flat 2',
    city: 'Lagos',
    region: 'Lagos',
    postal_code: '100001',
    country: 'NG',
    ...overrides,
  };
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, '..', 'addresses-test.db');

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  ownerToken = await signup('Address Owner', `address-owner-${run}@test.com`);
  otherToken = await signup('Address Other', `address-other-${run}@test.com`);
}, 30000);

describe('Address book', () => {
  it('requires authentication', async () => {
    const res = await supertest(app).get('/api/addresses');
    expect(res.status).toBe(401);
  });

  it('rejects invalid addresses', async () => {
    const res = await supertest(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ full_name: 'No Street' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('creates the first address as default', async () => {
    const res = await supertest(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(addressPayload());
    expect(res.status).toBe(201);
    expect(res.body.address.is_default).toBe(true);
    expect(res.body.address.country).toBe('NG');
    firstAddress = res.body.address;
  });

  it('creates a second address without replacing the default', async () => {
    const res = await supertest(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(addressPayload({ label: 'Work', line1: '2 Office Road' }));
    expect(res.status).toBe(201);
    expect(res.body.address.is_default).toBe(false);
    secondAddress = res.body.address;
  });

  it('lists addresses with the default first', async () => {
    const res = await supertest(app)
      .get('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(2);
    expect(res.body.addresses[0].id).toBe(firstAddress.id);
    expect(res.body.addresses[0].is_default).toBe(true);
  });

  it('switches the default address', async () => {
    const res = await supertest(app)
      .post(`/api/addresses/${secondAddress.id}/default`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.address.is_default).toBe(true);

    const list = await supertest(app)
      .get('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`);
    const first = list.body.addresses.find((a) => a.id === firstAddress.id);
    const second = list.body.addresses.find((a) => a.id === secondAddress.id);
    expect(first.is_default).toBe(false);
    expect(second.is_default).toBe(true);
  });

  it('updates an owned address', async () => {
    const res = await supertest(app)
      .put(`/api/addresses/${secondAddress.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ line1: '3 New Office Road', city: 'Abuja', is_default: true });
    expect(res.status).toBe(200);
    expect(res.body.address.line1).toBe('3 New Office Road');
    expect(res.body.address.city).toBe('Abuja');
    expect(res.body.address.is_default).toBe(true);
  });

  it('does not expose addresses to another user', async () => {
    const get = await supertest(app)
      .get(`/api/addresses/${firstAddress.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(get.status).toBe(404);

    const update = await supertest(app)
      .put(`/api/addresses/${firstAddress.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ city: 'Hijacked' });
    expect(update.status).toBe(404);

    const remove = await supertest(app)
      .delete(`/api/addresses/${firstAddress.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(remove.status).toBe(404);
  });

  it('promotes another address when the default is deleted', async () => {
    const res = await supertest(app)
      .delete(`/api/addresses/${secondAddress.id}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const list = await supertest(app)
      .get('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(list.body.addresses).toHaveLength(1);
    expect(list.body.addresses[0].id).toBe(firstAddress.id);
    expect(list.body.addresses[0].is_default).toBe(true);
  });

  it('enforces the per-user address limit', async () => {
    for (let i = 0; i < 19; i += 1) {
      const res = await supertest(app)
        .post('/api/addresses')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send(addressPayload({ label: `Extra ${i}`, line1: `${i + 10} Extra Street` }));
      expect(res.status).toBe(201);
    }

    const res = await supertest(app)
      .post('/api/addresses')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(addressPayload({ label: 'Too many' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Maximum of 20 addresses/);
  });
});
