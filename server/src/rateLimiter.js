import rateLimit from 'express-rate-limit';

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

export const authLimiter = rateLimit({
  ...base,
  max: 10,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

export const apiLimiter = rateLimit({ ...base, max: 100 });

export const adminLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: { error: 'Upload limit reached. Try again later.' },
});
