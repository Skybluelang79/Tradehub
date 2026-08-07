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
