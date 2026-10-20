import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let sellerToken;
let buyerToken;
let otherToken;

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

async function createItem(token, overrides = {}) {
  const res = await supertest(app)
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Test listing',
      description: 'A test item',
      price: 5000,
      category: 'electronics',
      condition: 'good',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.item;
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, '..', 'test.db');

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  sellerToken = await signup('Offer Seller', 'offer-seller@test.com');
  buyerToken = await signup('Offer Buyer', 'offer-buyer@test.com');
  otherToken = await signup('Offer Bystander', 'offer-other@test.com');
}, 30000);

describe('Offer lifecycle', () => {
  let item;

  it('seller creates an active listing', async () => {
    item = await createItem(sellerToken);
    expect(item.status).toBe('active');
    expect(item.price).toBe(5000);
  });

  it('buyer sends an offer', async () => {
    const res = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ itemId: item.id, amountCents: 450000, message: 'Will pick up today' });
    expect(res.status).toBe(201);
    expect(res.body.offer.amount_cents).toBe(450000);
    expect(res.body.offer.status).toBe('pending');
    expect(res.body.offer.buyer_name).toBe('Offer Buyer');
    expect(res.body.offer.seller_name).toBe('Offer Seller');
  });

  it('seller sees the offer as incoming', async () => {
    const res = await supertest(app)
      .get('/api/offers/incoming')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const match = (res.body.offers || []).find((o) => o.item_id === item.id);
    expect(match).toBeTruthy();
    expect(match.amount_cents).toBe(450000);
  });

  it('buyer sees the offer as outgoing', async () => {
    const res = await supertest(app)
      .get('/api/offers/outgoing')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect((res.body.offers || []).some((o) => o.item_id === item.id)).toBe(true);
  });

  it('seller is notified of the new offer', async () => {
    const res = await supertest(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    const notes = res.body.notifications || [];
    expect(notes.some((n) => /new offer/i.test(n.title || ''))).toBe(true);
  });

  it('rejects a second pending offer from the same buyer', async () => {
    const res = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ itemId: item.id, amountCents: 400000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pending offer/i);
  });

  it('rejects offers on own item, unknown item, and non-positive amounts', async () => {
    const own = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ itemId: item.id, amountCents: 100000 });
    expect(own.status).toBe(400);

    const missing = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ itemId: 'nope', amountCents: 100000 });
    expect(missing.status).toBe(404);

    const zero = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ itemId: item.id, amountCents: 0 });
    expect(zero.status).toBe(400);
  });

  it('bystander cannot accept the offer', async () => {
    const list = await supertest(app)
      .get('/api/offers/incoming')
      .set('Authorization', `Bearer ${sellerToken}`);
    const offer = list.body.offers.find((o) => o.item_id === item.id);
    const res = await supertest(app)
      .post(`/api/offers/${offer.id}/accept`)
      .set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);
  });

  it('seller accepts and the buyer is notified', async () => {
    const list = await supertest(app)
      .get('/api/offers/incoming')
      .set('Authorization', `Bearer ${sellerToken}`);
    const offer = list.body.offers.find((o) => o.item_id === item.id);
    const res = await supertest(app)
      .post(`/api/offers/${offer.id}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.offer.status).toBe('accepted');

    const notes = await supertest(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${buyerToken}`);
    const list2 = notes.body.notifications || [];
    expect(list2.some((n) => /accepted/i.test(n.title || ''))).toBe(true);
  });

  it('cannot act on an offer that is already accepted', async () => {
    const list = await supertest(app)
      .get('/api/offers/outgoing')
      .set('Authorization', `Bearer ${buyerToken}`);
    const offer = list.body.offers.find((o) => o.item_id === item.id);
    const res = await supertest(app)
      .post(`/api/offers/${offer.id}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
  });
});

describe('Counter-offer flow', () => {
  it('seller counters, buyer accepts', async () => {
    const item = await createItem(sellerToken, { title: 'Counter listing' });

    const created = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ itemId: item.id, amountCents: 300000 });
    expect(created.status).toBe(201);
    const offerId = created.body.offer.id;

    const counter = await supertest(app)
      .post(`/api/offers/${offerId}/counter`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ amountCents: 350000, message: 'Meet me halfway' });
    expect(counter.status).toBe(201);
    expect(counter.body.offer.amount_cents).toBe(350000);
    expect(counter.body.offer.offered_by).toBe('seller');
    expect(counter.body.offer.status).toBe('pending');

    const accept = await supertest(app)
      .post(`/api/offers/${counter.body.offer.id}/accept`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(accept.status).toBe(200);
    expect(accept.body.offer.status).toBe('accepted');
  });
});

describe('Cancel flow', () => {
  it('buyer withdraws a pending offer', async () => {
    const item = await createItem(sellerToken, { title: 'Cancel listing' });
    const created = await supertest(app)
      .post('/api/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ itemId: item.id, amountCents: 200000 });
    expect(created.status).toBe(201);

    const cancel = await supertest(app)
      .post(`/api/offers/${created.body.offer.id}/cancel`)
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.offer.status).toBe('cancelled');
  });
});
