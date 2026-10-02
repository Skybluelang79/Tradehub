import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import db from '../db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { generateRefreshToken } from './auth.js';
import validate, { webauthnLoginSchema, webauthnResponseSchema } from '../src/validation.js';
import { webauthnLimiter } from '../src/rateLimiter.js';
import logger from '../src/logger.js';

const router = Router();

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// The relying party is derived from the public app URL so a deployment only
// has to set APP_URL. WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS exist for the cases
// where the API and the app are served from different hosts.
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const RP_NAME = process.env.WEBAUTHN_RP_NAME || 'TradeHub';
const RP_ID = process.env.WEBAUTHN_RP_ID || safeHostname(APP_URL);
const ORIGINS = (process.env.WEBAUTHN_ORIGINS || APP_URL)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'localhost';
  }
}

/**
 * User verification is required, which is what forces a fingerprint, face or
 * device PIN rather than a presence-only tap. On a device with no screen lock
 * set up the passkey simply cannot be created or used, which is the correct
 * outcome for an app that moves money.
 */
const USER_VERIFICATION = 'required';

function storeChallenge(challenge, purpose, userId = null) {
  db.prepare("DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')").run();
  db.prepare(`
    INSERT INTO webauthn_challenges (id, challenge, user_id, purpose, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), challenge, userId, purpose, new Date(Date.now() + CHALLENGE_TTL_MS).toISOString());
}

/**
 * Fetch and immediately invalidate a challenge. Consuming it on read means a
 * captured response can never be replayed, even within the TTL.
 */
function takeChallenge(challenge, purpose) {
  const row = db.prepare(
    'SELECT * FROM webauthn_challenges WHERE challenge = ? AND purpose = ?'
  ).get(challenge, purpose);
  if (!row) return null;
  db.prepare('DELETE FROM webauthn_challenges WHERE id = ?').run(row.id);
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

function parseTransports(value) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function publicCredential(row) {
  return {
    id: row.id,
    credentialId: row.credential_id,
    deviceLabel: row.device_label || 'This device',
    backedUp: Boolean(row.backed_up),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
  };
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

// ---- Credential management --------------------------------------------------

router.get('/credentials', authenticateToken, (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json({ credentials: rows.map(publicCredential) });
  } catch (err) {
    logger.error('List webauthn credentials error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/credentials/:id', authenticateToken, (req, res) => {
  try {
    const result = db.prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Passkey not found' });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete webauthn credential error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Registration -----------------------------------------------------------

router.post('/register/options', authenticateToken, webauthnLimiter, async (req, res) => {
  try {
    const existing = db.prepare(
      'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?'
    ).all(req.user.id);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: req.user.email,
      userDisplayName: req.user.name,
      // Stable per account so the browser can recognise the same passkey.
      userID: Buffer.from(req.user.id),
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: USER_VERIFICATION,
      },
      excludeCredentials: existing.map((row) => ({
        id: row.credential_id,
        transports: parseTransports(row.transports),
      })),
    });

    storeChallenge(options.challenge, 'register', req.user.id);

    res.json(options);
  } catch (err) {
    logger.error('Webauthn register options error:', err);
    res.status(500).json({ error: 'Could not start passkey setup' });
  }
});

router.post('/register/verify', authenticateToken, webauthnLimiter, validate(webauthnResponseSchema), async (req, res) => {
  try {
    const response = req.validatedBody;
    const expectedChallenge = response.response?.clientDataJSON
      ? decodeClientDataChallenge(response.response.clientDataJSON)
      : null;

    const challengeRow = expectedChallenge ? takeChallenge(expectedChallenge, 'register') : null;
    if (!challengeRow || challengeRow.user_id !== req.user.id) {
      return res.status(400).json({ error: 'Passkey setup expired. Please try again.' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGINS,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      });
    } catch (err) {
      logger.warn(`Webauthn registration rejected: ${err.message}`);
      return res.status(400).json({ error: 'That passkey could not be verified' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'That passkey could not be verified' });
    }

    const { credential } = verification.registrationInfo;

    db.prepare(`
      INSERT INTO webauthn_credentials
        (id, user_id, credential_id, public_key, counter, transports, device_label, backed_up)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      req.user.id,
      credential.id,
      Buffer.from(credential.publicKey).toString('base64'),
      credential.counter,
      JSON.stringify(credential.transports || []),
      deviceLabelFromUserAgent(req.headers['user-agent']),
      verification.registrationInfo.credentialBackedUp ? 1 : 0
    );

    const row = db.prepare(
      'SELECT * FROM webauthn_credentials WHERE credential_id = ?'
    ).get(credential.id);

    res.status(201).json({ credential: publicCredential(row) });
  } catch (err) {
    logger.error('Webauthn register verify error:', err);
    res.status(500).json({ error: 'Could not save the passkey' });
  }
});

// ---- Authentication ---------------------------------------------------------

router.post('/login/options', webauthnLimiter, validate(webauthnLoginSchema), async (req, res) => {
  try {
    let allowCredentials = [];

    // When an email is supplied we can scope the prompt to that account's
    // passkeys. Without one the browser offers every passkey it holds for this
    // site, which is what makes a one-tap fingerprint sign-in possible.
    if (req.validatedBody.email) {
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(req.validatedBody.email);
      if (user) {
        allowCredentials = db.prepare(
          'SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?'
        ).all(user.id).map((row) => ({
          id: row.credential_id,
          transports: parseTransports(row.transports),
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: USER_VERIFICATION,
    });

    storeChallenge(options.challenge, 'login');

    res.json(options);
  } catch (err) {
    logger.error('Webauthn login options error:', err);
    res.status(500).json({ error: 'Could not start passkey sign-in' });
  }
});

router.post('/login/verify', webauthnLimiter, validate(webauthnResponseSchema), async (req, res) => {
  try {
    const response = req.validatedBody;
    const expectedChallenge = response.response?.clientDataJSON
      ? decodeClientDataChallenge(response.response.clientDataJSON)
      : null;

    const challengeRow = expectedChallenge ? takeChallenge(expectedChallenge, 'login') : null;
    if (!challengeRow) {
      return res.status(400).json({ error: 'Passkey sign-in expired. Please try again.' });
    }

    const row = db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?')
      .get(response.id);
    if (!row) {
      return res.status(401).json({ error: 'That passkey is not registered' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGINS,
        expectedRPID: RP_ID,
        credential: {
          id: row.credential_id,
          publicKey: Buffer.from(row.public_key, 'base64'),
          counter: row.counter,
          transports: parseTransports(row.transports),
        },
        requireUserVerification: true,
      });
    } catch (err) {
      logger.warn(`Webauthn authentication rejected: ${err.message}`);
      return res.status(401).json({ error: 'We could not verify your fingerprint' });
    }

    if (!verification.verified) {
      return res.status(401).json({ error: 'We could not verify your fingerprint' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
    if (!user) return res.status(401).json({ error: 'User not found' });

    try {
      blockIfRestricted(user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message, reason: err.reason });
    }

    // Track the signature counter; a value that goes backwards means the
    // credential was cloned onto another device.
    db.prepare("UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?")
      .run(verification.authenticationInfo.newCounter, row.id);

    const token = generateToken(user.id);
    res.json({ token, refreshToken: generateRefreshToken(user.id), user: publicUser(user) });
  } catch (err) {
    logger.error('Webauthn login verify error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Pull the challenge back out of the client's signed clientData so the
 * response can only be checked against a challenge this server issued.
 */
function decodeClientDataChallenge(clientDataJSON) {
  try {
    const json = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    return typeof parsed.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

/** A short human label so people can tell their passkeys apart. */
function deviceLabelFromUserAgent(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Safari\//.test(ua) ? 'Safari'
          : /Firefox\//.test(ua) ? 'Firefox'
            : 'Browser';
  const platform = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : '';
  return platform ? `${browser} on ${platform}` : browser;
}

export default router;