import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let sellerToken;
let tapItems = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, 'saved-cards-test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch {}
  }

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  sellerToken = await authUser('saved-cards-seller@test.com', 'Seller');

  for (const [title, price] of [['One-Tap Item A', 30], ['One-Tap Item B', 45]]) {
    const item = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title, description: 'saved card test', price, category: 'electronics', condition: 'good' });
    tapItems.push(item.body.item?.id || item.body.id);
  }
}, 30000);

async function authUser(email, name) {
  const signup = await supertest(app)
    .post('/api/auth/signup')
    .send({ name, email, password: 'password123' });
  if (signup.body.token) return signup.body.token;
  const login = await supertest(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' });
  return login.body.token;
}

describe('Saved cards', () => {
  it('stores a card with its Paystack authorization code and lists it', async () => {
    const token = await authUser('card-owner@test.com', 'Card Owner');

    const added = await supertest(app)
      .post('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`)
      .send({
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        is_default: true,
        authorizationCode: 'AUTH_abC1234',
      });
    expect(added.status).toBe(201);
    expect(added.body.method.paystack_authorization_code).toBe('AUTH_abC1234');
    expect(added.body.method.is_default).toBe(1);

    const listed = await supertest(app)
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`);
    expect(listed.body.methods.length).toBe(1);
    expect(listed.body.methods[0].last4).toBe('4242');
    expect(listed.body.methods[0].is_default).toBe(1);
  });

  it('sets the default and removes a saved card', async () => {
    const token = await authUser('card-switcher@test.com', 'Card Switcher');

    const first = await supertest(app)
      .post('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`)
      .send({ brand: 'verve', last4: '1111', is_default: true, authorizationCode: 'AUTH_first' });
    const second = await supertest(app)
      .post('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`)
      .send({ brand: 'mastercard', last4: '2222', authorizationCode: 'AUTH_second' });

    await supertest(app)
      .put(`/api/payments/methods/${second.body.method.id}/default`)
      .set('Authorization', `Bearer ${token}`);
    const afterDefault = await supertest(app)
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`);
    expect(afterDefault.body.methods.find((m) => m.is_default === 1).id).toBe(second.body.method.id);

    await supertest(app)
      .delete(`/api/payments/methods/${first.body.method.id}`)
      .set('Authorization', `Bearer ${token}`);
    const afterDelete = await supertest(app)
      .get('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`);
    expect(afterDelete.body.methods.length).toBe(1);
    expect(afterDelete.body.methods[0].id).toBe(second.body.method.id);
  });

  it('rejects Paystack tokenize endpoints when Paystack is not configured', async () => {
    const token = await authUser('card-tokenizer@test.com', 'Card Tokenizer');

    const init = await supertest(app)
      .post('/api/payments/methods/tokenize')
      .set('Authorization', `Bearer ${token}`);
    expect(init.status).toBe(503);

    const verify = await supertest(app)
      .post('/api/payments/methods/tokenize/save_unknown')
      .set('Authorization', `Bearer ${token}`);
    expect(verify.status).toBe(503);
  });
});

describe('Saved-card one-tap checkout', () => {
  it('rejects a create-intent that references an unknown saved card', async () => {
    const token = await authUser('unknown-card-buyer@test.com', 'Buyer');

    const res = await supertest(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: tapItems[0], method: 'card', paymentMethodId: 'no-such-card' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Saved card not found');
  });

  it('rejects a saved card without a Paystack authorization code', async () => {
    const token = await authUser('raw-card-buyer@test.com', 'Buyer');

    const added = await supertest(app)
      .post('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`)
      .send({ brand: 'visa', last4: '1111' });

    const res = await supertest(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: tapItems[1], method: 'card', paymentMethodId: added.body.method.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This saved card cannot be charged yet');
  });

  it('requires Paystack to be configured before charging a saved card', async () => {
    const token = await authUser('saved-card-buyer@test.com', 'Buyer');

    const added = await supertest(app)
      .post('/api/payments/methods')
      .set('Authorization', `Bearer ${token}`)
      .send({ brand: 'mastercard', last4: '2222', authorizationCode: 'AUTH_ready' });

    const res = await supertest(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: tapItems[0], method: 'card', paymentMethodId: added.body.method.id });
    expect(res.status).toBe(503);
  });

  it('rejects a cart checkout that references an unknown saved card', async () => {
    const token = await authUser('unknown-cart-card@test.com', 'Buyer');

    await supertest(app)
      .post('/api/payments/cart')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: tapItems[1] });

    const res = await supertest(app)
      .post('/api/payments/cart/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ method: 'card', paymentMethodId: 'no-such-card' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Saved card not found');
  });
});