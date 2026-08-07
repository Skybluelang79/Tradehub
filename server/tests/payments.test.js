import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let adminToken;
let sellerToken;
let itemIds = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, 'payments-test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch {}
  }

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  const admin = await supertest(app)
    .post('/api/admin/login')
    .send({ email: 'admin@tradehub.com', password: process.env.ADMIN_PASSWORD || 'admin123' });
  adminToken = admin.body.token;

  sellerToken = await authUser('pay-seller@test.com', 'Pay Seller');

  for (const [title, price] of [['Pay Item A', 25], ['Pay Item B', 40]]) {
    const item = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ title, description: 'payment test', price, category: 'electronics', condition: 'good' });
    itemIds.push(item.body.item?.id || item.body.id);
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

async function creditBuyer(token, cents) {
  const issue = await supertest(app)
    .post('/api/payments/gift-cards/issue')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ amountCents: cents, count: 1 });
  const code = issue.body.codes[0];
  await supertest(app)
    .post('/api/payments/gift-cards/redeem')
    .set('Authorization', `Bearer ${token}`)
    .send({ code });
}

describe('Payment refunds', () => {
  it('restores store credit used on a full-credit purchase', async () => {
    const token = await authUser('refund-buyer@test.com', 'Pay Buyer');
    await creditBuyer(token, 3000);

    const intent = await supertest(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: itemIds[0], method: 'credit' });
    expect(intent.status).toBe(200);
    expect(intent.body.paid).toBe(true);

    const before = await supertest(app)
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(before.body.wallet.credit_cents).toBe(500);

    const refund = await supertest(app)
      .post(`/api/payments/refund/${intent.body.transactionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(refund.status).toBe(200);

    const after = await supertest(app)
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.wallet.credit_cents).toBe(3000);
  });

  it('records credit_cents on split purchases and restores credit on refund', async () => {
    const token = await authUser('split-refund-buyer@test.com', 'Pay Buyer');
    await creditBuyer(token, 1000);

    const intent = await supertest(app)
      .post('/api/payments/create-intent')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: itemIds[1], method: 'card', useCredit: true });
    expect(intent.status).toBe(200);
    expect(intent.body.creditCents).toBe(1000);

    const receipt = await supertest(app)
      .get(`/api/payments/transactions/${intent.body.transactionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(receipt.body.receipt.credit_cents).toBe(1000);

    await supertest(app)
      .post(`/api/payments/refund/${intent.body.transactionId}`)
      .set('Authorization', `Bearer ${token}`);

    const after = await supertest(app)
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.wallet.credit_cents).toBe(1000);
  });
});

describe('Cart', () => {
  it('adds items, returns cart totals and clears', async () => {
    const token = await authUser('cart-buyer@test.com', 'Pay Buyer');

    for (const itemId of itemIds) {
      await supertest(app)
        .post('/api/payments/cart')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId });
    }

    const cart = await supertest(app)
      .get('/api/payments/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(cart.status).toBe(200);
    expect(cart.body.count).toBe(2);
    expect(cart.body.subtotalCents).toBe(6500);

    await supertest(app)
      .delete('/api/payments/cart')
      .set('Authorization', `Bearer ${token}`);
    const empty = await supertest(app)
      .get('/api/payments/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(empty.body.count).toBe(0);
  });

  it('checks out multiple items with a split credit + card remainder', async () => {
    const token = await authUser('cart-split-buyer@test.com', 'Pay Buyer');
    await creditBuyer(token, 1000);

    for (const itemId of itemIds) {
      await supertest(app)
        .post('/api/payments/cart')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemId });
    }

    const checkout = await supertest(app)
      .post('/api/payments/cart/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ method: 'card' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.creditCents).toBe(1000);
    expect(checkout.body.totalCents).toBe(6500);
    expect(checkout.body.transactionIds.length).toBe(2);

    const wallet = await supertest(app)
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${token}`);
    expect(wallet.body.wallet.credit_cents).toBe(0);

    const cart = await supertest(app)
      .get('/api/payments/cart')
      .set('Authorization', `Bearer ${token}`);
    expect(cart.body.count).toBe(0);
  });

  it('rejects checking out an empty cart', async () => {
    const token = await authUser('empty-cart-buyer@test.com', 'Pay Buyer');
    const res = await supertest(app)
      .post('/api/payments/cart/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ method: 'card' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Your cart is empty');
  });
});
