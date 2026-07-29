import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let app;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = join(__dirname, '..', 'test.db');

  const db = (await import('../db.js')).default;
  const index = await import('../index.js');
  app = (await import('express')).default();
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
