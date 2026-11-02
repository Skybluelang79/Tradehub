import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import validate, {
  signupSchema, loginSchema, updateProfileSchema, storeProfileSchema, twoFactorCodeSchema,
  changePasswordSchema, forgotPasswordSchema, resetPasswordSchema,
} from '../src/validation.js';
import { authLimiter, writeLimiter } from '../src/rateLimiter.js';
import { requiredSecret, requiredEnv } from '../src/env.js';
import { sendVerificationEmail, sendPasswordResetEmail, isEmailConfigured } from '../src/email.js';
import logger from '../src/logger.js';
import { applyReferral } from './referrals.js';
import {
  generateSecret, verifyTotp, otpauthUrl, generateBackupCodes, consumeBackupCode,
} from '../src/totp.js';

const router = Router();

const JWT_SECRET = requiredSecret('JWT_SECRET');
const REFRESH_SECRET = requiredSecret('REFRESH_SECRET');

function publicUser(user) {
  const {
    password, two_factor_secret: secret, two_factor_backup_codes: backupCodes, kyc_data: kycData, ...safe
  } = user;
  void password;
  void secret;
  void backupCodes;
  void kycData;
  return safe;
}

function consumeSecondFactor(user, code) {
  const value = String(code || '').trim();
  if (!value) return false;
  if (user.two_factor_secret && verifyTotp(user.two_factor_secret, value)) return true;

  const remaining = consumeBackupCode(user.two_factor_backup_codes, value);
  if (!remaining) return false;

  db.prepare("UPDATE users SET two_factor_backup_codes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(remaining), user.id);
  user.two_factor_backup_codes = JSON.stringify(remaining);
  return true;
}

function issueSession(user) {
  return {
    token: generateToken(user.id),
    refreshToken: generateRefreshToken(user.id),
    user: publicUser(user),
  };
}

export function generateRefreshToken(userId) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), userId, token, expiresAt);
  return token;
}

router.post('/signup', authLimiter, validate(signupSchema), (req, res) => {
  try {
    const { name, email, password, username, referralCode } = req.validatedBody;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
    const normalizedUsername = (username || '').trim();

    db.prepare(`
      INSERT INTO users (id, name, username, email, password, avatar)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, normalizedUsername, email, hashedPassword, avatar);

    if (referralCode) {
      try { applyReferral(id, referralCode); } catch (err) { logger.warn(`Referral apply failed: ${err.message}`); }
    }

    const verifyToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO email_verifications (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), id, verifyToken, expiresAt);

    const isDev = process.env.NODE_ENV !== 'production';
    const sendFailed = !isEmailConfigured();
    sendVerificationEmail(email, verifyToken).catch(err => {
      logger.warn(`Verification email failed for ${email}: ${err.message}`);
    });

    const token = generateToken(id);
    const refreshToken = generateRefreshToken(id);
    const user = db.prepare('SELECT id, name, username, email, avatar, bio, phone, verified, rating, review_count, created_at FROM users WHERE id = ?').get(id);

    db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
    db.prepare(`
      INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status, trial_end)
      VALUES (?, ?, 'premium', 'trial', datetime('now', '+90 days'))
    `).run(uuidv4(), id);

    const payload = { token, refreshToken, user };
    if (isDev && sendFailed) {
      payload.devVerifyToken = verifyToken;
    }
    res.status(201).json(payload);
  } catch (err) {
    logger.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', authLimiter, validate(loginSchema), (req, res) => {
  try {
    const { email, password } = req.validatedBody;

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ error: 'Your account has been banned', reason: user.banned_reason || '' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended', reason: user.banned_reason || '' });
    }

    if (user.two_factor_enabled) {
      const challengeToken = jwt.sign(
        { userId: user.id, purpose: '2fa_login' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ twoFactorRequired: true, challengeToken });
    }

    res.json(issueSession(user));
  } catch (err) {
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/verify-login', authLimiter, (req, res) => {
  try {
    const { challengeToken, code } = req.body || {};
    if (!challengeToken || !code) {
      return res.status(400).json({ error: 'Challenge token and code are required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(challengeToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Your sign-in session expired. Please log in again.' });
    }
    if (decoded.purpose !== '2fa_login') {
      return res.status(401).json({ error: 'Invalid sign-in challenge' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
    if (!user || !user.two_factor_enabled) {
      return res.status(401).json({ error: 'Two-factor authentication is not enabled for this account' });
    }
    if (user.status === 'banned' || user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account is not available', reason: user.banned_reason || '' });
    }
    if (!consumeSecondFactor(user, code)) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }

    res.json(issueSession(user));
  } catch (err) {
    logger.error('2FA login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/2fa/status', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT two_factor_enabled, two_factor_backup_codes FROM users WHERE id = ?').get(req.user.id);
    let remaining = 0;
    try { remaining = JSON.parse(user?.two_factor_backup_codes || '[]').length; } catch { remaining = 0; }
    res.json({ enabled: Boolean(user?.two_factor_enabled), backupCodesRemaining: remaining });
  } catch (err) {
    logger.error('2FA status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/setup', authenticateToken, writeLimiter, (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (user.two_factor_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    }

    const secret = generateSecret();
    db.prepare("UPDATE users SET two_factor_secret = ?, updated_at = datetime('now') WHERE id = ?")
      .run(secret, user.id);

    res.json({
      secret,
      otpauthUrl: otpauthUrl({ secret, label: user.email || user.username || user.name }),
      issuer: 'TradeHub',
    });
  } catch (err) {
    logger.error('2FA setup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/enable', authenticateToken, writeLimiter, validate(twoFactorCodeSchema), (req, res) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (user.two_factor_enabled) {
      return res.status(400).json({ error: 'Two-factor authentication is already enabled' });
    }
    if (!user.two_factor_secret) {
      return res.status(400).json({ error: 'Start two-factor setup first' });
    }
    if (!verifyTotp(user.two_factor_secret, req.validatedBody.code)) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }

    const { plain, hashed } = generateBackupCodes();
    db.prepare(`
      UPDATE users SET two_factor_enabled = 1, two_factor_backup_codes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(hashed), user.id);

    res.json({ enabled: true, backupCodes: plain });
  } catch (err) {
    logger.error('2FA enable error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/disable', authenticateToken, writeLimiter, (req, res) => {
  try {
    const { password, code } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }
    if (!consumeSecondFactor(user, code)) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }

    db.prepare(`
      UPDATE users SET two_factor_enabled = 0, two_factor_secret = '', two_factor_backup_codes = '[]',
      updated_at = datetime('now') WHERE id = ?
    `).run(user.id);

    res.json({ enabled: false });
  } catch (err) {
    logger.error('2FA disable error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/2fa/backup-codes', authenticateToken, writeLimiter, (req, res) => {
  try {
    const { password, code } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }
    if (!consumeSecondFactor(user, code)) {
      return res.status(401).json({ error: 'Invalid authentication code' });
    }

    const { plain, hashed } = generateBackupCodes();
    db.prepare("UPDATE users SET two_factor_backup_codes = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(hashed), user.id);

    res.json({ backupCodes: plain });
  } catch (err) {
    logger.error('2FA backup codes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/store', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT store_slug, store_banner, store_description FROM users WHERE id = ?').get(req.user.id);
    res.json({
      store: {
        slug: user?.store_slug || '',
        banner: user?.store_banner || '',
        description: user?.store_description || '',
        url: user?.store_slug ? `/store/${user.store_slug}` : null,
      },
    });
  } catch (err) {
    logger.error('Get store settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/store', authenticateToken, writeLimiter, validate(storeProfileSchema), (req, res) => {
  try {
    const { storeSlug = '', storeBanner = '', storeDescription = '' } = req.validatedBody;
    const slug = String(storeSlug || '').trim().toLowerCase();

    if (slug && !/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(slug)) {
      return res.status(400).json({
        error: 'Store link must be 3-30 characters using letters, numbers, hyphens or underscores',
      });
    }
    if (storeBanner && !/^(\/uploads\/|https?:\/\/)/.test(storeBanner)) {
      return res.status(400).json({ error: 'Banner must be an uploaded image or a valid URL' });
    }
    if (slug) {
      const taken = db.prepare('SELECT id FROM users WHERE store_slug = ? AND id != ?').get(slug, req.user.id);
      if (taken) return res.status(409).json({ error: 'That store link is already taken' });
    }

    db.prepare(`
      UPDATE users SET store_slug = ?, store_banner = ?, store_description = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(slug || null, storeBanner || '', String(storeDescription || '').trim(), req.user.id);

    res.json({
      store: {
        slug,
        banner: storeBanner || '',
        description: String(storeDescription || '').trim(),
        url: slug ? `/store/${slug}` : null,
      },
    });
  } catch (err) {
    logger.error('Update store settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/social', authLimiter, async (req, res) => {
  try {
    const { provider, token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token required' });
    if (!['google', 'facebook'].includes(provider)) {
      return res.status(400).json({ error: 'Unsupported provider' });
    }

    let profile;
    if (provider === 'google') {
      const clientId = requiredEnv('GOOGLE_CLIENT_ID', '');
      if (!clientId) return res.status(503).json({ error: 'Google login is not configured' });
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
      if (!r.ok) return res.status(401).json({ error: 'Invalid Google token' });
      const data = await r.json();
      // tokeninfo verifies the signature and expiry but does NOT check that the
      // token was minted for this application. Without the audience check an ID
      // token issued to any other Google client is accepted, letting an
      // attacker sign in as (or create) an account for any Google address.
      if (data.aud !== clientId) {
        return res.status(401).json({ error: 'Google token was issued for a different application' });
      }
      if (!data.email) return res.status(401).json({ error: 'Google account has no email' });
      profile = {
        email: data.email.toLowerCase(),
        name: data.name || data.email.split('@')[0],
        avatar: data.picture || '',
        verified: data.email_verified ? 1 : 0,
      };
    } else {
      const appId = requiredEnv('FACEBOOK_APP_ID', '');
      const appSecret = requiredEnv('FACEBOOK_APP_SECRET', '');
      if (!appId || !appSecret) return res.status(503).json({ error: 'Facebook login is not configured' });
      const r = await fetch(
        `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${appSecret}`
      );
      if (!r.ok) return res.status(401).json({ error: 'Invalid Facebook token' });
      const { data } = await r.json();
      if (!data.is_valid) return res.status(401).json({ error: 'Invalid Facebook token' });
      const p = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${encodeURIComponent(token)}`);
      const fb = await p.json();
      profile = {
        email: (fb.email || '').toLowerCase(),
        name: fb.name || 'TradeHub User',
        avatar: fb.picture?.data?.url || '',
        verified: 1,
      };
    }

    if (!profile.email) return res.status(401).json({ error: 'Email is required from social provider' });

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
    if (!user) {
      const id = uuidv4();
      const hashedPassword = bcrypt.hashSync(`${uuidv4()}${Date.now()}`, 10);
      db.prepare(`
        INSERT INTO users (id, name, email, password, avatar, verified)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, profile.name, profile.email, hashedPassword, profile.avatar, profile.verified);
      db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
      db.prepare(`
        INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status, trial_end)
        VALUES (?, ?, 'premium', 'trial', datetime('now', '+90 days'))
      `).run(uuidv4(), id);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(profile.email);
    }

    if (user.status === 'banned') {
      return res.status(403).json({ error: 'Your account has been banned', reason: user.banned_reason || '' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended', reason: user.banned_reason || '' });
    }

    if (user.two_factor_enabled) {
      const challengeToken = jwt.sign(
        { userId: user.id, purpose: '2fa_login' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ twoFactorRequired: true, challengeToken });
    }

    res.json(issueSession(user));
  } catch (err) {
    logger.error('Social login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const stored = db.prepare(
      'SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0 AND expires_at > datetime("now")'
    ).get(refreshToken);

    if (!stored) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(stored.id);

    const newToken = generateToken(stored.user_id);
    const newRefreshToken = generateRefreshToken(stored.user_id);

    res.json({ token: newToken, refreshToken: newRefreshToken });
  } catch (err) {
    logger.error('Refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', authenticateToken, (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(refreshToken);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/search', (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const users = db.prepare(`
      SELECT id, name, avatar, bio, verified, rating, review_count
      FROM users WHERE name LIKE ? ORDER BY rating DESC LIMIT ? OFFSET ?
    `).all(`%${q.trim()}%`, parseInt(limit), offset);
    const total = db.prepare('SELECT COUNT(*) as count FROM users WHERE name LIKE ?').get(`%${q.trim()}%`);
    res.json({ users, total: total.count });
  } catch (err) {
    logger.error('Search users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/batch', (req, res) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ error: 'ids query parameter required (comma-separated)' });
    const idList = ids.split(',').filter(Boolean);
    if (idList.length === 0) return res.json({ users: [] });

    const placeholders = idList.map(() => '?').join(',');
    const users = db.prepare(`
      SELECT id, name, avatar, bio, verified, rating, review_count
      FROM users WHERE id IN (${placeholders})
    `).all(...idList);
    res.json({ users });
  } catch (err) {
    logger.error('Batch users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:userId/profile', (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, avatar, bio, verified, identity_verified, rating, review_count, created_at FROM users WHERE id = ?').get(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_listings,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_listings,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_listings
      FROM items WHERE seller_id = ?
    `).get(req.params.userId);

    res.json({ user, stats });
  } catch (err) {
    logger.error('Get user profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

router.put('/me', authenticateToken, validate(updateProfileSchema), (req, res) => {
  try {
    const { name, username, bio, phone, avatar, location } = req.validatedBody;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (username !== undefined) { updates.push('username = ?'); params.push((username || '').trim()); }
    if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (avatar !== undefined) { updates.push('avatar = ?'); params.push(avatar); }
    if (location !== undefined) {
      if (location.address !== undefined) { updates.push('location_address = ?'); params.push(location.address); }
      if (location.lat !== undefined) { updates.push('location_lat = ?'); params.push(location.lat); }
      if (location.lng !== undefined) { updates.push('location_lng = ?'); params.push(location.lng); }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push("updated_at = datetime('now')");
    params.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const user = db.prepare('SELECT id, name, username, email, avatar, bio, phone, verified, identity_verified, rating, review_count, location_lat, location_lng, location_address, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
  } catch (err) {
    logger.error('Update profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/change-password', authenticateToken, validate(changePasswordSchema), (req, res) => {
  try {
    const { currentPassword, newPassword } = req.validatedBody;

    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    const valid = bcrypt.compareSync(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = bcrypt.hashSync(newPassword, 10);
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hashed, req.user.id);

    res.json({ message: 'Password updated' });
  } catch (err) {
    logger.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), (req, res) => {
  try {
    const { email } = req.validatedBody;

    // Locally, hand the token back so the flow is testable without SMTP.
    const devMode = process.env.NODE_ENV !== 'production' && !isEmailConfigured();

    // In production, report a global misconfiguration instead of silently
    // accepting a request we cannot fulfil. This does not reveal whether the
    // account exists.
    if (!isEmailConfigured() && !devMode) {
      return res.status(503).json({ error: 'Password reset email is not configured' });
    }

    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

    let devResetToken = null;
    if (user) {
      const token = uuidv4();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.prepare(`
        INSERT INTO password_resets (id, email, token, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(uuidv4(), email, token, expiresAt);

      sendPasswordResetEmail(email, token).catch(err => {
        logger.warn(`Password reset email failed for ${email}: ${err.message}`);
      });

      if (devMode) devResetToken = token;
    }

    const body = { message: 'If an account exists with this email, you will receive reset instructions' };
    if (devResetToken) body.devResetToken = devResetToken;
    res.json(body);
  } catch (err) {
    logger.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/reset-password', authLimiter, validate(resetPasswordSchema), (req, res) => {
  try {
    const { token, password } = req.validatedBody;

    const reset = db.prepare(
      'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime("now")'
    ).get(token);

    if (!reset) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = datetime("now") WHERE email = ?').run(hashed, reset.email);
    db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    logger.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-email', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    const verification = db.prepare(
      'SELECT * FROM email_verifications WHERE token = ? AND used = 0 AND expires_at > datetime("now")'
    ).get(token);

    if (!verification) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(verification.user_id);
    db.prepare('UPDATE email_verifications SET used = 1 WHERE id = ?').run(verification.id);

    res.json({ message: 'Email verified successfully' });
  } catch (err) {
    logger.error('Verify email error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/me', authenticateToken, (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password required to delete account' });
    }
    const user = db.prepare('SELECT password, email FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM favorites WHERE user_id = ? OR item_id IN (SELECT id FROM items WHERE seller_id = ?)').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM item_images WHERE item_id IN (SELECT id FROM items WHERE seller_id = ?)').run(req.user.id);
    db.prepare('DELETE FROM items WHERE seller_id = ?').run(req.user.id);
    // Children before parents: messages must go before the conversations they
    // reference, or deleting the conversations orphans every message.
    db.prepare('DELETE FROM message_attachments WHERE conversation_id IN (SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?)').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?)').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM conversation_settings WHERE conversation_id IN (SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?)').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM call_logs WHERE conversation_id IN (SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?)').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM conversations WHERE buyer_id = ? OR seller_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM reviews WHERE reviewer_id = ? OR reviewee_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM payment_methods WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM templates WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM offers WHERE buyer_id = ? OR seller_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM bids WHERE bidder_id = ?').run(req.user.id);
    db.prepare('DELETE FROM saved_searches WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM verification_requests WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM webauthn_credentials WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM support_tickets WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM referrals WHERE referrer_id = ? OR referred_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM wallets WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM payouts WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM gift_card_designs WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM password_resets WHERE email = ?').run(user.email);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);

    res.json({ success: true, message: 'Account permanently deleted' });
  } catch (err) {
    logger.error('Delete account error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-verification', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, email, verified FROM users WHERE id = ?').get(req.user.id);
    if (user.verified) {
      return res.json({ message: 'Email already verified' });
    }

    // Same gate as forgot-password: in production, report the missing SMTP
    // configuration instead of accepting a request we cannot fulfil.
    const devMode = process.env.NODE_ENV !== 'production' && !isEmailConfigured();
    if (!isEmailConfigured() && !devMode) {
      return res.status(503).json({ error: 'Verification email is not configured' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO email_verifications (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), user.id, token, expiresAt);

    sendVerificationEmail(user.email, token).catch(err => {
      logger.warn(`Resend verification failed for ${user.email}: ${err.message}`);
    });

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    logger.error('Resend verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
