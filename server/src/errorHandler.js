import logger from './logger.js';

export class AppError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

// Request bodies regularly carry credentials (login passwords, API tokens,
// card data). Logging them verbatim wrote plaintext passwords to error.log the
// first time a 500 happened -- redact known-sensitive keys before logging.
const SENSITIVE_KEY = /pass(word|code)?|secret|token|authorization|api[-_]?key|otp|pin|cvv|cvc|card[-_]?number|account[-_]?number|gift[-_]?card/i;
const REDACTED = '[redacted]';

export function redactSensitive(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, depth + 1));
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactSensitive(entry, depth + 1);
  }
  return out;
}

export function errorHandler(err, req, res, _next) {
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB.' });
    }
    return res.status(400).json({ error: err.message });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Upload is too large for this endpoint.' });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: req.body ? JSON.stringify(redactSensitive(req.body)).slice(0, 500) : null,
  });

  res.status(500).json({ error: 'Internal server error' });
}

export function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
}
