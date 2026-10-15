import crypto from 'crypto';

// Development-only defaults used to be checked into this file as literals
// ("tradehub-secret-key-change-in-production-2026" and friends). A published
// literal is a public key: anyone who reaches a deployment that forgot to set
// NODE_ENV (or JWT_SECRET) could forge admin tokens. Generate a random value
// instead -- still convenient locally, but useless to an attacker.
const secretCache = new Map();

export function requiredSecret(name) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required secret ${name}. Set it in server/.env or the host environment.`);
  }
  if (!secretCache.has(name)) {
    secretCache.set(name, crypto.randomBytes(32).toString('hex'));
    process.emitWarning(
      `${name} is not set; using a random development-only value. Tokens will not survive a server restart.`
    );
  }
  return secretCache.get(name);
}

export function requiredEnv(name, devFallback) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  if (devFallback) {
    process.emitWarning(`Environment variable ${name} is not set. Using an insecure development fallback. Set it in server/.env before deploying.`);
    return devFallback;
  }
  return '';
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function allowedOrigins() {
  if (process.env.APP_URL) {
    return process.env.APP_URL.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (isProduction()) return [];
  return ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001'];
}
