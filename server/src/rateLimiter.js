import rateLimit from 'express-rate-limit';

// In-memory rate limiting is unreliable in serverless/Lambda: counters are
// per-container and req.ip is not the real client IP, so limits get burned
// by unrelated requests on the same warm instance. It also trips on local
// dev (e.g. admin lockouts) because counters reset per process.
// Limits are therefore opt-in: set RATE_LIMIT_ENABLED=true to activate them.
const IS_SERVERLESS =
  process.env.NETLIFY === 'true' ||
  process.env.DB_BLOB === 'true' ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const RATE_LIMIT_ENABLED = !IS_SERVERLESS && process.env.RATE_LIMIT_ENABLED === 'true';

const keyGenerator = (req) =>
  req.ip || req.headers['x-forwarded-for'] || req.headers['client-ip'] || 'global';

const base = {
  windowMs: 15 * 60 * 1000,
  message: { error: 'Too many requests. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  validate: {
    ip: false,
    trustProxy: false,
    xForwardedForHeader: false,
    keyGeneratorIpFallback: false,
  },
};

const passThrough = () => (req, res, next) => next();

export const authLimiter = RATE_LIMIT_ENABLED
  ? rateLimit({
      ...base,
      max: 10,
      message: { error: 'Too many attempts. Try again in 15 minutes.' },
    })
  : passThrough();

export const apiLimiter = RATE_LIMIT_ENABLED ? rateLimit({ ...base, max: 100 }) : passThrough();

export const adminLimiter = RATE_LIMIT_ENABLED
  ? rateLimit({
      ...base,
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: { error: 'Too many login attempts. Try again in 15 minutes.' },
    })
  : passThrough();

export const uploadLimiter = RATE_LIMIT_ENABLED
  ? rateLimit({
      ...base,
      windowMs: 60 * 60 * 1000,
      max: 20,
      message: { error: 'Upload limit reached. Try again later.' },
    })
  : passThrough();
