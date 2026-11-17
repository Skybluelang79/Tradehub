import { describe, it, expect, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, 'ai-settings-test.db');

let app;
let adminToken;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.REFRESH_SECRET = 'test-refresh-secret';
  process.env.NODE_ENV = 'test';
  process.env.DB_PATH = dbPath;
  try { fs.unlinkSync(dbPath); } catch {}

  await (await import('../db.js')).ensureLoaded();
  app = (await import('../app.js')).default;

  const login = await supertest(app)
    .post('/api/admin/login')
    .send({ email: 'admin@tradehub.com', password: process.env.ADMIN_PASSWORD || 'admin123' });
  adminToken = login.body.token;
}, 30000);

describe('AI platform settings', () => {
  it('returns AI defaults without exposing the API key', async () => {
    const response = await supertest(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.settings).not.toHaveProperty('ai_api_key');
    expect(response.body.settings.ai_api_key_set).toBe('0');
    expect(response.body.settings.ai_provider).toBe('openai');
    expect(typeof response.body.ai_prompt_defaults.listing).toBe('string');
  });

  it('rejects unknown AI providers', async () => {
    const response = await supertest(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ai_provider: 'unknown-provider' });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/provider/i);
  });

  it('saves provider, model, prompts and a masked API key', async () => {
    const response = await supertest(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ai_enabled: '1',
        ai_provider: 'openai-compatible',
        ai_model: 'test-model',
        ai_base_url: 'https://example.test/v1',
        ai_api_key: 'secret-test-key',
        ai_prompt_listing: 'Custom listing prompt',
        ai_prompt_search: 'Custom search prompt',
        ai_prompt_question: 'Custom question prompt',
      });

    expect(response.status).toBe(200);
    expect(response.body.settings.ai_provider).toBe('openai-compatible');
    expect(response.body.settings.ai_model).toBe('test-model');
    expect(response.body.settings.ai_prompt_listing).toBe('Custom listing prompt');
    expect(response.body.settings.ai_api_key_set).toBe('1');
    expect(response.body.settings.ai_api_key_source).toBe('database');
    expect(response.body.settings.ai_ready).toBe('1');
    expect(response.body.settings).not.toHaveProperty('ai_api_key');
  });

  it('clears the saved API key', async () => {
    const response = await supertest(app)
      .put('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ai_api_key_clear: '1' });

    expect(response.status).toBe(200);
    expect(response.body.settings.ai_api_key_set).toBe('0');
    expect(response.body.settings.ai_ready).toBe('0');
  });
});
