import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import validate, {
  signupSchema, loginSchema, updateProfileSchema,
  changePasswordSchema, forgotPasswordSchema, resetPasswordSchema,
} from '../src/validation.js';
import { authLimiter } from '../src/rateLimiter.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../src/email.js';
import logger from '../src/logger.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'tradehub-secret-key-change-in-production-2026';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'tradehub-refresh-secret-change-in-production-2026';

function generateRefreshToken(userId) {
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
    const { name, email, password } = req.validatedBody;

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;

    db.prepare(`
      INSERT INTO users (id, name, email, password, avatar)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, email, hashedPassword, avatar);

    const verifyToken = uuidv4();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO email_verifications (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(uuidv4(), id, verifyToken, expiresAt);

    sendVerificationEmail(email, verifyToken).catch(err => {
      logger.warn(`Verification email failed for ${email}: ${err.message}`);
    });

    const token = generateToken(id);
    const refreshToken = generateRefreshToken(id);
    const user = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, created_at FROM users WHERE id = ?').get(id);

    db.prepare('INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)').run(id);
    db.prepare(`
      INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status, trial_end)
      VALUES (?, ?, 'premium', 'trial', datetime('now', '+90 days'))
    `).run(uuidv4(), id);

    res.status(201).json({ token, refreshToken, user });
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

    const token = generateToken(user.id);
    const refreshToken = generateRefreshToken(user.id);
    const { password: _, ...userWithoutPassword } = user;

    res.json({ token, refreshToken, user: userWithoutPassword });
  } catch (err) {
    logger.error('Login error:', err);
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
      SELECT id, name, email, avatar, bio, verified, rating, review_count
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
      SELECT id, name, email, avatar, bio, verified, rating, review_count
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
    const user = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, created_at FROM users WHERE id = ?').get(req.params.userId);
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
    const { name, bio, phone, avatar, location } = req.validatedBody;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
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

    const user = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, location_lat, location_lng, location_address, created_at FROM users WHERE id = ?').get(req.user.id);
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
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);

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
    }

    res.json({ message: 'If an account exists with this email, you will receive reset instructions' });
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
    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
    if (password && !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM item_images WHERE item_id IN (SELECT id FROM items WHERE seller_id = ?)').run(req.user.id);
    db.prepare('DELETE FROM items WHERE seller_id = ?').run(req.user.id);
    db.prepare('DELETE FROM conversations WHERE buyer_id = ? OR seller_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM reviews WHERE reviewer_id = ? OR reviewee_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?').run(req.user.id, req.user.id);
    db.prepare('DELETE FROM payment_methods WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM templates WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(req.user.id);
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
