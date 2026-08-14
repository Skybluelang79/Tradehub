import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, '..', 'test.db');

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;
});

describe('Health Check', () => {
  it('GET /api/health returns ok', async () => {
    const response = await supertest(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body).toHaveProperty('timestamp');
  });
});

describe('Auth Routes', () => {
  it('POST /api/auth/signup with missing fields returns 400', async () => {
    const response = await supertest(app)
      .post('/api/auth/signup')
      .send({});
    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty('error');
  });

  it('POST /api/auth/signup with invalid email returns 400', async () => {
    const response = await supertest(app)
      .post('/api/auth/signup')
      .send({ name: 'Test', email: 'notanemail', password: '123456' });
    expect(response.status).toBe(400);
  });

  it('POST /api/auth/login with wrong credentials returns 401', async () => {
    const response = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@test.com', password: 'wrong' });
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Invalid email or password');
  });
});

describe('Items Routes', () => {
  it('GET /api/items returns array', async () => {
    const response = await supertest(app).get('/api/items');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body).toHaveProperty('total');
  });

  it('GET /api/items with category filter', async () => {
    const response = await supertest(app)
      .get('/api/items?category=electronics');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('items');
  });

  it('GET /api/items with search query', async () => {
    const response = await supertest(app)
      .get('/api/items?search=test');
    expect(response.status).toBe(200);
  });

  it('GET /api/items with pagination', async () => {
    const response = await supertest(app)
      .get('/api/items?page=1&limit=5');
    expect(response.status).toBe(200);
  });
});

describe('Validation Schemas', () => {
  it('signupSchema rejects short password', async () => {
    const { signupSchema } = await import('../src/validation.js');
    const result = signupSchema.safeParse({ name: 'Test', email: 'test@test.com', password: '123' });
    expect(result.success).toBe(false);
  });

  it('signupSchema accepts valid data', async () => {
    const { signupSchema } = await import('../src/validation.js');
    const result = signupSchema.safeParse({ name: 'Test User', email: 'test@test.com', password: '123456' });
    expect(result.success).toBe(true);
  });
});

describe('Seller Analytics', () => {
  let token;

  beforeAll(async () => {
    const signup = await supertest(app)
      .post('/api/auth/signup')
      .send({ name: 'Analyst Seller', email: 'analyst@test.com', password: 'password123' });
    if (signup.body.token) token = signup.body.token;
    else {
      const login = await supertest(app)
        .post('/api/auth/login')
        .send({ email: 'analyst@test.com', password: 'password123' });
      token = login.body.token;
    }
  });

  it('requires auth', async () => {
    const response = await supertest(app).get('/api/payments/analytics/seller');
    expect(response.status).toBe(401);
  });

  it('returns totals and per-item breakdown for the seller', async () => {
    const response = await supertest(app)
      .get('/api/payments/analytics/seller')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('totals');
    expect(response.body).toHaveProperty('revenue');
    expect(response.body).toHaveProperty('perItem');
    expect(Array.isArray(response.body.perItem)).toBe(true);
    expect(response.body).toHaveProperty('sales');
  });
});

describe('Admin Dashboard', () => {
  let adminToken;

  beforeAll(async () => {
    const login = await supertest(app)
      .post('/api/admin/login')
      .send({ email: 'admin@tradehub.com', password: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.token;
    expect(adminToken).toBeTruthy();
  });

  it('rejects unauthenticated dashboard access', async () => {
    const response = await supertest(app).get('/api/admin/dashboard');
    expect(response.status).toBe(401);
  });

  it('returns real KPIs for the admin', async () => {
    const response = await supertest(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('stats');
    expect(response.body.stats).toHaveProperty('totalUsers');
    expect(response.body.stats).toHaveProperty('totalRevenue');
    expect(response.body.stats).toHaveProperty('totalFees');
    expect(Array.isArray(response.body.revenueByDay)).toBe(true);
    expect(Array.isArray(response.body.topViewedItems)).toBe(true);
  });
});

describe('Disputes', () => {
  let userToken;

  beforeAll(async () => {
    const login = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'analyst@test.com', password: 'password123' });
    userToken = login.body.token;

    const item = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        title: 'Dispute Test Item',
        description: 'An item to test dispute flows',
        price: 45,
        category: 'electronics',
        condition: 'good',
      });
    const itemId = item.body.item?.id || item.body.id;

    if (itemId) {
      await supertest(app)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ itemId });
    }
  });

  it('POST /api/disputes with invalid data returns 400', async () => {
    const response = await supertest(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ transactionId: '', reason: '' });
    expect(response.status).toBe(400);
  });

  it('POST /api/disputes requires auth', async () => {
    const response = await supertest(app)
      .post('/api/disputes')
      .send({ transactionId: 'x', reason: 'test' });
    expect(response.status).toBe(401);
  });

  it('non-admin cannot resolve a dispute', async () => {
    const response = await supertest(app)
      .put('/api/disputes/some-id/resolve')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ action: 'refund_buyer' });
    expect(response.status).toBe(403);
  });
});

describe('Maintenance Mode', () => {
  let adminToken;

  beforeAll(async () => {
    const login = await supertest(app)
      .post('/api/admin/login')
      .send({ email: 'admin@tradehub.com', password: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.token;
  });

  it('allows normal traffic when maintenance is off', async () => {
    const response = await supertest(app).get('/api/items');
    expect(response.status).toBe(200);
  });

  it('blocks non-admin API calls with 503 when maintenance is on', async () => {
    const db = await import('../db.js');
    db.default.prepare("UPDATE platform_settings SET value = '1' WHERE key = 'maintenance_mode'").run();

    const items = await supertest(app).get('/api/items');
    expect(items.status).toBe(503);
    expect(items.body.maintenance).toBe(true);

    const health = await supertest(app).get('/api/health');
    expect(health.status).toBe(200);

    const admin = await supertest(app)
      .get('/api/admin/dashboard')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);

    db.default.prepare("UPDATE platform_settings SET value = '0' WHERE key = 'maintenance_mode'").run();
  });

  it('serves traffic again after maintenance is turned off', async () => {
    const response = await supertest(app).get('/api/items');
    expect(response.status).toBe(200);
  });
});

describe('Platform Fee Setting', () => {
  it('getFeeRateForSeller honors the admin platform_fee_percent setting', async () => {
    const db = await import('../db.js');
    const { getFeeRateForSeller } = await import('../routes/payments.js');

    db.default.prepare("UPDATE platform_settings SET value = '7.5' WHERE key = 'platform_fee_percent'").run();
    const rate = getFeeRateForSeller('no-such-user');
    expect(rate).toBeCloseTo(0.075, 5);

    db.default.prepare("UPDATE platform_settings SET value = '10' WHERE key = 'platform_fee_percent'").run();
    const reset = getFeeRateForSeller('no-such-user');
    expect(reset).toBeCloseTo(0.1, 5);
  });
});

describe('Admin Listing Approval', () => {
  let adminToken;
  let sellerToken;
  let sellerId;
  let itemId;

  beforeAll(async () => {
    const login = await supertest(app)
      .post('/api/admin/login')
      .send({ email: 'admin@tradehub.com', password: process.env.ADMIN_PASSWORD || 'admin123' });
    adminToken = login.body.token;

    const sellerLogin = await supertest(app)
      .post('/api/auth/login')
      .send({ email: 'analyst@test.com', password: 'password123' });
    sellerToken = sellerLogin.body.token;

    const me = await supertest(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${sellerToken}`);
    sellerId = me.body.user?.id || me.body.id;

    const item = await supertest(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Pending Approval Item',
        description: 'Item that starts pending for moderation',
        price: 25,
        category: 'electronics',
        condition: 'new',
      });
    itemId = item.body.item?.id || item.body.id;
    expect(itemId).toBeTruthy();
  });

  it('new listings are created active', async () => {
    const response = await supertest(app).get(`/api/items/${itemId}`);
    expect(response.status).toBe(200);
    expect(response.body.item.status).toBe('active');
  });

  it('admin can move a listing to pending, hiding it from the public feed', async () => {
    const response = await supertest(app)
      .put(`/api/admin/listings/${itemId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'pending' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const detail = await supertest(app).get(`/api/items/${itemId}`);
    expect(detail.body.item.status).toBe('pending');

    const feed = await supertest(app).get('/api/items?search=pending');
    const found = (feed.body.items || []).some((i) => i.id === itemId);
    expect(found).toBe(false);
  });

  it('admin can approve a pending listing back to active', async () => {
    const response = await supertest(app)
      .put(`/api/admin/listings/${itemId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const detail = await supertest(app).get(`/api/items/${itemId}`);
    expect(detail.body.item.status).toBe('active');
  });

  it('approved listings appear in the public feed', async () => {
    const response = await supertest(app).get('/api/items?search=pending');
    const found = (response.body.items || []).some((i) => i.id === itemId);
    expect(found).toBe(true);
  });
});

describe('Seller Storefront', () => {
  it('returns seller info, listings and follow counts', async () => {
    const db = await import('../db.js');
    const seller = db.default.prepare("SELECT id FROM users WHERE email = 'analyst@test.com'").get();
    expect(seller).toBeTruthy();

    const response = await supertest(app).get(`/api/follows/storefront/${seller.id}`);
    expect(response.status).toBe(200);
    expect(response.body.user).toHaveProperty('name');
    expect(response.body).toHaveProperty('listings');
    expect(Array.isArray(response.body.listings)).toBe(true);
    expect(response.body).toHaveProperty('stats');
    expect(response.body).toHaveProperty('followerCount');
    expect(response.body).toHaveProperty('followingCount');
    expect(response.body).toHaveProperty('isFollowing');
  });

  it('returns 404 for an unknown seller', async () => {
    const response = await supertest(app).get('/api/follows/storefront/no-such-user');
    expect(response.status).toBe(404);
  });

  it('returns public reviews for a seller', async () => {
    const db = await import('../db.js');
    const seller = db.default.prepare("SELECT id FROM users WHERE email = 'analyst@test.com'").get();
    const response = await supertest(app).get(`/api/reviews/user/${seller.id}`);
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('reviews');
    expect(Array.isArray(response.body.reviews)).toBe(true);
  });
});
