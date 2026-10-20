import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let buyerToken;
let buyerId;

async function signup(name, email) {
  const res = await supertest(app)
    .post('/api/auth/signup')
    .send({ name, email, password: 'password123' });
  if (res.body.token) return res.body;
  const login = await supertest(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' });
  return login.body;
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DEMO_MODE = 'true';
  process.env.PAYSTACK_SECRET_KEY = '';
  process.env.DB_PATH = join(__dirname, '..', 'giftcards-test.db');
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DB_PATH + suffix); } catch {}
  }

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  const buyer = await signup('Gift Buyer', 'gift-buyer@test.com');
  buyerToken = buyer.token;
  buyerId = buyer.user?.id;
}, 30000);

async function mallBrands() {
  const res = await supertest(app).get('/api/payments/gift-cards/mall');
  expect(res.status).toBe(200);
  return res.body.brands || [];
}

describe('Gift Mall purchasing', () => {
  it('exposes the sellable TradeHub brand to the mall', async () => {
    const brands = await mallBrands();
    const tradehub = brands.find((b) => b.name === 'TradeHub Gift Card');
    expect(tradehub).toBeTruthy();
    expect(tradehub.sellable).toBe(1);
  });

  it('requires authentication to start a purchase', async () => {
    const res = await supertest(app)
      .post('/api/payments/gift-cards/purchase-intent')
      .send({ brandId: 'anything', amountCents: 500000 });
    expect(res.status).toBe(401);
  });

  it('rejects a brand that is not sellable', async () => {
    const brands = await mallBrands();
    const catalogOnly = brands.find((b) => !b.sellable);
    if (!catalogOnly) return;
    const res = await supertest(app)
      .post('/api/payments/gift-cards/purchase-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ brandId: catalogOnly.id, amountCents: 500000 });
    expect(res.status).toBe(400);
  });

  it('rejects amounts below the minimum', async () => {
    const brands = await mallBrands();
    const sellable = brands.find((b) => b.sellable);
    const res = await supertest(app)
      .post('/api/payments/gift-cards/purchase-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ brandId: sellable.id, amountCents: 100 });
    expect(res.status).toBe(400);
  });

  it('credits the wallet and records store sales in demo mode', async () => {    const brands = await mallBrands();
    const sellable = brands.find((b) => b.sellable);

    const walletBefore = await supertest(app)
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${buyerToken}`);
    const creditBefore = walletBefore.body.wallet.credit_cents;

    const res = await supertest(app)
      .post('/api/payments/gift-cards/purchase-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ brandId: sellable.id, amountCents: 500000 });

    expect(res.status).toBe(200);
    expect(res.body.paid).toBe(true);
    expect(res.body.demo).toBe(true);
    expect(res.body.card.status).toBe('redeemed');
    expect(res.body.card.sold_to).toBe(buyerId);
    expect(res.body.creditCents).toBe(creditBefore + 500000);

    const walletAfter = await supertest(app)
      .get('/api/payments/wallet')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(walletAfter.body.wallet.credit_cents).toBe(creditBefore + 500000);

    const notifications = await supertest(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${buyerToken}`);
    const payload = JSON.stringify(notifications.body);
    expect(payload).toContain('Gift Card Credited');
  }, 30000);

  it('is idempotent when verifying a completed purchase', async () => {
    const brands = await mallBrands();
    const sellable = brands.find((b) => b.sellable);
    const created = await supertest(app)
      .post('/api/payments/gift-cards/purchase-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ brandId: sellable.id, amountCents: 200000 });
    expect(created.status).toBe(200);

    const verify = await supertest(app)
      .post(`/api/payments/gift-cards/purchase/verify/${created.body.reference}`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(verify.status).toBe(200);
    expect(verify.body.alreadyProcessed).toBe(true);
  }, 30000);

  it('does not leak another user\'s purchase', async () => {
    const other = await signup('Gift Other', 'gift-other@test.com');
    const brands = await mallBrands();
    const sellable = brands.find((b) => b.sellable);
    const created = await supertest(app)
      .post('/api/payments/gift-cards/purchase-intent')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ brandId: sellable.id, amountCents: 300000 });

    const res = await supertest(app)
      .post(`/api/payments/gift-cards/purchase/verify/${created.body.reference}`)
      .set('Authorization', `Bearer ${other.token}`);
    expect(res.status).toBe(403);
  }, 30000);
});
