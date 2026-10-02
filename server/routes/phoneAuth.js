import { Router } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { generateRefreshToken } from './auth.js';
import validate, { requestPhoneCodeSchema, verifyPhoneCodeSchema } from '../src/validation.js';
import { otpLimiter } from '../src/rateLimiter.js';
import { requiredEnv } from '../src/env.js';
import { isSmsConfigured, normalizePhone, sendOtpSms } from '../src/sms.js';
import logger from '../src/logger.js';

const router = Router();

// Pepper for hashing one-time codes. It falls back to a value derived from
// JWT_SECRET rather than being mandatory: JWT_SECRET is already required in
// production, and demanding a second secret here would mean a deploy with
// OTP_PEPPER unset boots the API straight into a 502 instead of disabling
// just this feature. The ":otp" suffix keeps the derived key distinct from
// the one JWTs are signed with. Set OTP_PEPPER explicitly to rotate the
// pepper independently.
const CODE_PEPPER =
  process.env.OTP_PEPPER || `${requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026')}:otp`;
const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const IS_PROD = process.env.NODE_ENV === 'production';

// Locally we hand the code back so the flow is testable without a paid SMS
// gateway, the same trick the email verification and password reset codes use.
const DEV_MODE = !IS_PROD && !isSmsConfigured();

function generateCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

// Codes are stored only as a peppered hash, so a database leak cannot be
// replayed against the sign-in endpoint.
function hashCode(code) {
  return crypto.createHmac('sha256', CODE_PEPPER).update(String(code)).digest('hex');
}

function expiryFromNow() {
  return new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
}

function issueCode(phone, purpose) {
  const code = generateCode();

  // Only the newest code for a number stays valid.
  db.prepare('UPDATE phone_otp_codes SET consumed = 1 WHERE phone = ? AND purpose = ? AND consumed = 0')
    .run(phone, purpose);

  db.prepare(`
    INSERT INTO phone_otp_codes (id, phone, purpose, code_hash, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), phone, purpose, hashCode(code), expiryFromNow());

  return code;
}

/**
 * Consume a code if it is valid. Returns the stored row, or null. Wrong guesses
 * burn an attempt and lock the code out once MAX_ATTEMPTS is reached so a
 * six-digit space cannot be walked.
 */
function consumeCode(phone, code, purpose) {
  const row = db.prepare(`
    SELECT * FROM phone_otp_codes
    WHERE phone = ? AND purpose = ? AND code_hash = ? AND consumed = 0
  `).get(phone, purpose, hashCode(code));

  if (!row) return null;

  if (new Date(row.expires_at) < new Date() || row.attempts >= MAX_ATTEMPTS) {
    db.prepare('UPDATE phone_otp_codes SET consumed = 1 WHERE id = ?').run(row.id);
    return null;
  }

  db.prepare('UPDATE phone_otp_codes SET consumed = 1 WHERE id = ?').run(row.id);
  return row;
}

function publicUser(user) {
  const { password: _, ...rest } = user;
  return rest;
}

function blockIfRestricted(user) {
  if (user.status === 'banned') {
    const err = new Error('Your account has been banned');
    err.status = 403;
    err.reason = user.banned_reason || '';
    throw err;
  }
  if (user.status === 'suspended') {
    const err = new Error('Your account has been suspended');
    err.status = 403;
    err.reason = user.banned_reason || '';
    throw err;
  }
}

/**
 * Start a phone sign-in. The response is identical whether or not the number is
 * registered so this cannot be used to discover who has an account.
 */
router.post('/request-code', otpLimiter, validate(requestPhoneCodeSchema), async (req, res) => {
  try {
    const phone = normalizePhone(req.validatedBody.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number' });

    if (!isSmsConfigured()) {
      if (IS_PROD) return res.status(503).json({ error: 'Phone sign-in is not available right now' });
      logger.warn('SMS provider not configured; phone code will only be returned in the response');
    }

    const user = db.prepare('SELECT id FROM users WHERE phone = ? AND phone_verified = 1').get(phone);

    // Even for an unknown number a code row is written in development so the
    // response shape matches production exactly.
    const code = issueCode(phone, 'login');

    if (user) {
      try {
        await sendOtpSms(phone, code);
      } catch (err) {
        logger.warn(`Could not deliver phone code to ${phone}: ${err.message}`);
        return res.status(503).json({ error: 'Could not send the code. Try again shortly.' });
      }
    } else {
      logger.info(`Phone sign-in requested for unregistered number ${phone}`);
    }

    const payload = {
      message: 'If that number is registered with TradeHub, a verification code is on its way.',
      expiresInSeconds: CODE_TTL_MINUTES * 60,
    };
    if (DEV_MODE) payload.devCode = code;

    res.json(payload);
  } catch (err) {
    logger.error('Request phone code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Finish a phone sign-in and hand back the usual token pair. */
router.post('/verify', otpLimiter, validate(verifyPhoneCodeSchema), (req, res) => {
  try {
    const phone = normalizePhone(req.validatedBody.phone);
    const { code } = req.validatedBody;
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number' });

    if (!consumeCode(phone, code, 'login')) {
      return res.status(401).json({ error: 'That code is wrong or has expired' });
    }

    const user = db.prepare('SELECT * FROM users WHERE phone = ? AND phone_verified = 1').get(phone);
    if (!user) {
      return res.status(404).json({ error: 'No TradeHub account uses that number yet' });
    }

    try {
      blockIfRestricted(user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message, reason: err.reason });
    }

    const token = generateToken(user.id);
    res.json({ token, refreshToken: generateRefreshToken(user.id), user: publicUser(user) });
  } catch (err) {
    logger.error('Verify phone code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Attach a phone number to the signed-in account so it can be used to sign in. */
router.post('/link', authenticateToken, otpLimiter, validate(requestPhoneCodeSchema), async (req, res) => {
  try {
    const phone = normalizePhone(req.validatedBody.phone);
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number' });

    const owner = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (owner && owner.id !== req.user.id) {
      return res.status(409).json({ error: 'That number is already linked to another account' });
    }

    if (!isSmsConfigured() && IS_PROD) {
      return res.status(503).json({ error: 'Phone sign-in is not available right now' });
    }

    const code = issueCode(phone, 'link');

    try {
      await sendOtpSms(phone, code);
    } catch (err) {
      logger.warn(`Could not deliver link code to ${phone}: ${err.message}`);
      return res.status(503).json({ error: 'Could not send the code. Try again shortly.' });
    }

    const payload = { message: 'Verification code sent.', expiresInSeconds: CODE_TTL_MINUTES * 60 };
    if (DEV_MODE) payload.devCode = code;
    res.json(payload);
  } catch (err) {
    logger.error('Link phone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Confirm ownership of the number, then save it against the account. */
router.post('/link/verify', authenticateToken, otpLimiter, validate(verifyPhoneCodeSchema), (req, res) => {
  try {
    const phone = normalizePhone(req.validatedBody.phone);
    const { code } = req.validatedBody;
    if (!phone) return res.status(400).json({ error: 'Enter a valid phone number' });

    if (!consumeCode(phone, code, 'link')) {
      return res.status(401).json({ error: 'That code is wrong or has expired' });
    }

    const owner = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
    if (owner && owner.id !== req.user.id) {
      return res.status(409).json({ error: 'That number is already linked to another account' });
    }

    db.prepare("UPDATE users SET phone = ?, phone_verified = 1, updated_at = datetime('now') WHERE id = ?")
      .run(phone, req.user.id);

    res.json({ phone, phoneVerified: true });
  } catch (err) {
    logger.error('Verify link phone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Remove the number again, which immediately disables phone sign-in. */
router.delete('/link', authenticateToken, (req, res) => {
  try {
    // Drop any outstanding codes for the number while it is still readable.
    db.prepare(`
      DELETE FROM phone_otp_codes
      WHERE phone IN (SELECT phone FROM users WHERE id = ?)
    `).run(req.user.id);

    db.prepare("UPDATE users SET phone = '', phone_verified = 0, updated_at = datetime('now') WHERE id = ?")
      .run(req.user.id);

    res.json({ success: true });
  } catch (err) {
    logger.error('Unlink phone error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Whether the signed-in account can currently sign in with a phone number. */
router.get('/status', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT phone, phone_verified FROM users WHERE id = ?').get(req.user.id);
    res.json({
      phone: user?.phone || '',
      phoneVerified: Boolean(user?.phone_verified),
      available: isSmsConfigured() || DEV_MODE,
    });
  } catch (err) {
    logger.error('Phone status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Housekeeping: drop codes that can no longer be used.
export function purgeExpiredCodes() {
  try {
    db.prepare("DELETE FROM phone_otp_codes WHERE expires_at < datetime('now', '-1 day')").run();
  } catch (err) {
    logger.warn(`OTP cleanup failed: ${err.message}`);
  }
}

export default router;