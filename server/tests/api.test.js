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
