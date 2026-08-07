import rateLimit from 'express-rate-limit';

const IS_SERVERLESS =
  process.env.NETLIFY === 'true' ||
  process.env.DB_BLOB === 'true' ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME;

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

// In-memory rate limiting is unreliable in serverless/Lambda: counters are
// per-container and req.ip is not the real client IP, so limits get burned
// by unrelated requests on the same warm instance. Disable it there.
const passThrough = () => (req, res, next) => next();

export const authLimiter = IS_SERVERLESS
  ? passThrough()
  : rateLimit({
      ...base,
      max: 10,
      message: { error: 'Too many attempts. Try again in 15 minutes.' },
    });

export const apiLimiter = IS_SERVERLESS ? passThrough() : rateLimit({ ...base, max: 100 });

export const adminLimiter = IS_SERVERLESS
  ? passThrough()
  : rateLimit({
      ...base,
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: { error: 'Too many login attempts. Try again in 15 minutes.' },
    });

export const uploadLimiter = IS_SERVERLESS
  ? passThrough()
  : rateLimit({
      ...base,
      windowMs: 60 * 60 * 1000,
      max: 20,
      message: { error: 'Upload limit reached. Try again later.' },
    });
