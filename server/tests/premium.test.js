import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;
let db;
let seller;
let sellerId;

async function signup(email) {
  const res = await supertest(app)
    .post('/api/auth/signup')
    .send({ name: 'Gold Seller', email, password: 'password123' });
  return res.body;
}

function setPlan(plan, status = 'active', trialEnd = null, periodEnd = null) {
  db.prepare(`
    UPDATE subscriptions SET plan = ?, status = ?, trial_end = ?, current_period_end = ?, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(plan, status, trialEnd, periodEnd, sellerId);
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'premium-test-jwt';
  process.env.REFRESH_SECRET = 'premium-test-refresh';
  process.env.NODE_ENV = 'test';
  const dbPath = join(__dirname, 'premium-test.db');
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath);
  process.env.DB_PATH = dbPath;

  const dbModule = await import('../db.js');
  db = dbModule.default;
  await dbModule.ensureLoaded();
  app = (await import('../app.js')).default;

  const account = await signup('gold-seller@test.com');
  seller = account.token;
  sellerId = account.user.id;
});

describe('Gold subscription entitlements', () => {
  it('exposes Gold pricing and trial entitlements', async () => {
    const plans = await supertest(app).get('/api/subscription/plans');
    const gold = plans.body.plans.find((p) => p.id === 'premium');
    expect(gold.name).toBe('Gold');
    expect(gold.price).toBe(9.99);
    expect(gold.fee).toBe(0.02);
    expect(gold.maxListings).toBe(120);
    expect(gold.maxPhotos).toBe(10);
    expect(gold.maxVideos).toBe(1);
    expect(gold.listingDays).toBe(90);
    expect(gold.featuredSlots).toBe(7);

    const current = await supertest(app)
      .get('/api/subscription/current')
      .set('Authorization', `Bearer ${seller}`);
    expect(current.body.subscription.plan).toBe('premium');
    expect(current.body.subscription.name).toBe('Gold');
    expect(current.body.subscription.maxListings).toBe(120);
  });

  it('reverts an expired trial to free entitlements', async () => {
    setPlan('premium', 'trial', '2020-01-01 00:00:00');
    const current = await supertest(app)
      .get('/api/subscription/current')
      .set('Authorization', `Bearer ${seller}`);
    expect(current.body.subscription.plan).toBe('free');
    expect(current.body.subscription.maxListings).toBe(30);
  });

  it('enforces photo and video limits by plan', async () => {
    setPlan('free');
    const tooManyPhotos = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${seller}`)
      .send({
        title: 'Seven photos',
        price: 10,
        category: 'electronics',
        images: Array.from({ length: 7 }, (_, i) => `/uploads/${i}.jpg`),
      });
    expect(tooManyPhotos.status).toBe(403);

    const freeVideo = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${seller}`)
      .send({ title: 'Free video', price: 10, category: 'electronics', video_url: '/uploads/video.mp4' });
    expect(freeVideo.status).toBe(403);

    setPlan('premium', 'trial', '2030-01-01 00:00:00');
    const goldVideo = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${seller}`)
      .send({
        title: 'Gold video',
        price: 10,
        category: 'electronics',
        images: Array.from({ length: 10 }, (_, i) => `/uploads/${i}.jpg`),
        video_url: '/uploads/video.mp4',
      });
    expect(goldVideo.status).toBe(201);
    expect(goldVideo.body.item.video_url).toBe('/uploads/video.mp4');
  });

  it('auto-approves Gold auctions and holds free auctions for review', async () => {
    setPlan('free');
    const freeAuction = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${seller}`)
      .send({
        title: 'Free auction',
        price: 10,
        category: 'electronics',
        is_auction: true,
        starting_bid: 5,
        auction_ends_at: '2030-01-01T00:00:00.000Z',
      });
    expect(freeAuction.status).toBe(201);
    expect(freeAuction.body.item.status).toBe('pending');

    setPlan('premium', 'trial', '2030-01-01 00:00:00');
    const goldAuction = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${seller}`)
      .send({
        title: 'Gold auction',
        price: 10,
        category: 'electronics',
        is_auction: true,
        starting_bid: 5,
        auction_ends_at: '2030-01-01T00:00:00.000Z',
      });
    expect(goldAuction.status).toBe(201);
    expect(goldAuction.body.item.status).toBe('active');
  });

  it('enforces the free 30-listing limit', async () => {
    setPlan('free');
    db.prepare("UPDATE items SET status = 'sold' WHERE seller_id = ?").run(sellerId);
    const insert = db.prepare(
      "INSERT INTO items (id, title, price, category, seller_id, status) VALUES (?, ?, 10, 'electronics', ?, 'active')"
    );
    for (let i = 0; i < 30; i++) insert.run(uuidv4(), `Limit item ${i}`, sellerId);

    const blocked = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${seller}`)
      .send({ title: 'One too many', price: 10, category: 'electronics' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toContain('30 active listings');
  });

  it('expires and locks listings after their duration', async () => {
    const { runScheduledJobs } = await import('../src/scheduler.js');
    const item = db.prepare("SELECT id FROM items WHERE seller_id = ? AND status = 'active' LIMIT 1").get(sellerId);
    db.prepare("UPDATE items SET expires_at = datetime('now', '-1 day') WHERE id = ?").run(item.id);

    runScheduledJobs();

    const locked = db.prepare('SELECT status, locked_at FROM items WHERE id = ?').get(item.id);
    expect(locked.status).toBe('expired');
    expect(locked.locked_at).toBeTruthy();
  });

  it('renews an expired listing and restores its active status', async () => {
    const item = db.prepare("SELECT id FROM items WHERE seller_id = ? AND status = 'expired' LIMIT 1").get(sellerId);
    const renewed = await supertest(app)
      .post(`/api/items/${item.id}/renew`)
      .set('Authorization', `Bearer ${seller}`);
    expect(renewed.status).toBe(200);
    expect(renewed.body.expires_at).toBeTruthy();

    const row = db.prepare('SELECT status, locked_at, expires_at FROM items WHERE id = ?').get(item.id);
    expect(row.status).toBe('active');
    expect(row.locked_at).toBeNull();
    expect(row.expires_at).toBeTruthy();
  });
});
