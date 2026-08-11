import { Router } from 'express';
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { exportDatabase, replaceDatabase } from '../db.js';
import { adminLimiter } from '../src/rateLimiter.js';
import { sendNotificationEmail } from '../src/email.js';
import { refundTxn } from './payments.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { requiredEnv } from '../src/env.js';
import logger from '../src/logger.js';
import pkg from '../package.json' with { type: 'json' };

const router = Router();
const ADMIN_EMAIL = 'admin@tradehub.com';
const ADMIN_PASSWORD = requiredEnv('ADMIN_PASSWORD', 'admin123');
const JWT_SECRET = requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026');
const USER_STATUSES = ['active', 'suspended', 'banned'];
const TX_STATUSES = ['pending', 'completed', 'refunded', 'awaiting_payment', 'failed', 'cancelled'];

if (process.env.ADMIN_PASSWORD === undefined || process.env.JWT_SECRET === undefined) {
  logger.warn('Admin using default credentials. Set ADMIN_PASSWORD and JWT_SECRET env vars in production.');
}

function logAudit(adminId, action, entityType, entityId, details = {}) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), adminId, action, entityType, entityId, JSON.stringify(details));
  } catch (err) {
    logger.error('Audit log error:', err);
  }
}

function paginate(req) {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  return { page, limit, offset: (page - 1) * limit };
}

function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[randomBytes(1)[0] % chars.length];
  return out;
}

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values) {
  return values.map(csvEscape).join(',');
}

function sendCsv(res, filename, headers, rows) {
  const lines = [csvRow(headers), ...rows.map((r) => csvRow(headers.map((h) => r[h])))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + lines.join('\r\n'));
}

router.post('/login', adminLimiter, (req, res) => {
  const { email, password } = req.body;
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  let admin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (!admin) {
    const id = 'admin-1';
    const hashed = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.prepare("INSERT INTO users (id, name, email, password, avatar, verified, is_admin) VALUES (?, 'Admin', ?, ?, 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 1, 1)").run(id, ADMIN_EMAIL, hashed);
    admin = { id };
  }
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin.id);
  const token = jwt.sign(
    { userId: admin.id, isAdmin: true },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  logAudit(admin.id, 'admin_login', 'user', admin.id);
  res.json({ token });
});

router.get('/dashboard', adminAuth, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
    const activeItems = db.prepare("SELECT COUNT(*) as count FROM items WHERE status = 'active'").get().count;
    const totalTransactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'completed'").get().total;
    const totalFees = db.prepare("SELECT COALESCE(SUM(fee_amount), 0) as total FROM transactions WHERE status = 'completed'").get().total;
    const pendingReports = db.prepare("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'").get().count;
    const pendingUserReports = db.prepare("SELECT COUNT(*) as count FROM user_reports WHERE status = 'pending'").get().count;
    const openDisputes = db.prepare("SELECT COUNT(*) as count FROM disputes WHERE status = 'open'").get().count;
    const flaggedListings = db.prepare("SELECT COUNT(*) as count FROM items WHERE status = 'flagged'").get().count;
    const pendingVerifications = db.prepare('SELECT COUNT(*) as count FROM email_verifications WHERE used = 0 AND expires_at > datetime("now")').get().count;
    const totalViews = db.prepare('SELECT COALESCE(SUM(views), 0) as total FROM items').get().total;
    const pendingPayouts = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM payouts WHERE status IN ('pending','approved')").get().total;
    const paidOut = db.prepare("SELECT COALESCE(SUM(amount_cents), 0) as total FROM payouts WHERE status = 'completed'").get().total;
    const activeWallets = db.prepare('SELECT COUNT(*) as count FROM wallets WHERE available_cents > 0').get().count;
    const giftCardsIssued = db.prepare('SELECT COUNT(*) as count FROM gift_cards').get().count;
    const giftCardsRedeemed = db.prepare("SELECT COUNT(*) as count FROM gift_cards WHERE status = 'redeemed'").get().count;

    const recentUsers = db.prepare('SELECT id, name, email, avatar, created_at FROM users ORDER BY created_at DESC LIMIT 5').all();
    const recentItems = db.prepare('SELECT id, title, price, status, views, created_at FROM items ORDER BY created_at DESC LIMIT 5').all();
    const topViewedItems = db.prepare('SELECT id, title, price, views, status FROM items ORDER BY views DESC LIMIT 5').all();
    const recentTransactions = db.prepare(`
      SELECT t.id, t.item_title, t.amount, t.fee_amount, t.status, t.created_at,
        buyer.name as buyer_name, seller.name as seller_name
      FROM transactions t
      LEFT JOIN users buyer ON buyer.id = t.buyer_id
      LEFT JOIN users seller ON seller.id = t.seller_id
      ORDER BY t.created_at DESC LIMIT 5
    `).all();
    const revenueByDay = db.prepare(`
      SELECT DATE(completed_at) as date, SUM(amount) as revenue, COUNT(*) as sales
      FROM transactions WHERE status = 'completed' AND completed_at > datetime('now', '-30 days')
      GROUP BY DATE(completed_at) ORDER BY date
    `).all();
    const topCategories = db.prepare(`
      SELECT category, COUNT(*) as count FROM items WHERE status = 'active'
      GROUP BY category ORDER BY count DESC LIMIT 5
    `).all();
    const userSignupsByDay = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM users WHERE created_at > datetime('now', '-30 days')
      GROUP BY DATE(created_at) ORDER BY date
    `).all();

    const recentPendingReports = db.prepare(`
      SELECT 'item' as type, r.id, r.reason, r.created_at, i.title as target, u.name as reporter
      FROM reports r
      JOIN items i ON i.id = r.item_id
      JOIN users u ON u.id = r.reporter_id
      WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5
    `).all();
    const recentPendingUserReports = db.prepare(`
      SELECT 'user' as type, r.id, r.reason, r.created_at, u2.name as target, u.name as reporter
      FROM user_reports r
      JOIN users u ON u.id = r.reporter_id
      JOIN users u2 ON u2.id = r.reported_user_id
      WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5
    `).all();
    const recentFlagged = db.prepare('SELECT id, title, price, views FROM items WHERE status = \'flagged\' ORDER BY updated_at DESC LIMIT 5').all();
    const recentDisputes = db.prepare(`
      SELECT d.id, d.reason, d.created_at, t.item_title, u.name as opened_by
      FROM disputes d
      LEFT JOIN transactions t ON t.id = d.transaction_id
      LEFT JOIN users u ON u.id = d.opened_by
      WHERE d.status = 'open' ORDER BY d.created_at DESC LIMIT 5
    `).all();

    res.json({
      stats: {
        totalUsers, totalItems, activeItems, totalTransactions, totalRevenue, totalFees,
        pendingReports: pendingReports + pendingUserReports, pendingUserReports, openDisputes, flaggedListings,
        pendingVerifications, totalViews, pendingPayouts, paidOut, activeWallets, giftCardsIssued, giftCardsRedeemed,
      },
      recentUsers, recentItems, topViewedItems, recentTransactions, revenueByDay, topCategories, userSignupsByDay,
      recentPendingReports: [...recentPendingUserReports, ...recentPendingReports], recentFlagged, recentDisputes,
    });
  } catch (err) {
    logger.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', adminAuth, (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');

    const where = [];
    const params = [];
    if (q) {
      where.push('(name LIKE ? OR email LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status === 'pending') {
      where.push('verified = 0');
    } else if (status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM users ${whereSql}`).get(...params).count;
    const users = db.prepare(`
      SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, is_admin, status, banned_reason, created_at,
        (SELECT COUNT(*) FROM items WHERE seller_id = users.id) as listing_count
      FROM users ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users/:id', adminAuth, (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, is_admin, status, banned_reason, created_at
      FROM users WHERE id = ?
    `).get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const listings = db.prepare('SELECT id, title, price, status, views, created_at FROM items WHERE seller_id = ? ORDER BY created_at DESC').all(user.id);
    const transactions = db.prepare(`
      SELECT t.id, t.item_title, t.amount, t.fee_amount, t.status, t.created_at, t.buyer_id, t.seller_id
      FROM transactions t WHERE t.buyer_id = ? OR t.seller_id = ? ORDER BY t.created_at DESC LIMIT 20
    `).all(user.id, user.id);
    const reviews = db.prepare(`
      SELECT r.rating, r.text, r.created_at, u.name as reviewer FROM reviews r
      JOIN users u ON u.id = r.reviewer_id WHERE r.reviewee_id = ? ORDER BY r.created_at DESC LIMIT 10
    `).all(user.id);
    const subscription = db.prepare('SELECT plan, status FROM subscriptions WHERE user_id = ?').get(user.id) || null;

    res.json({
      user: { ...user, listing_count: listings.length },
      listings, transactions, reviews, subscription,
    });
  } catch (err) {
    logger.error('Get user detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:id/verify', adminAuth, (req, res) => {
  try {
    db.prepare('UPDATE users SET verified = 1 WHERE id = ?').run(req.params.id);
    logAudit(req.adminId, 'user_verified', 'user', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:id/status', adminAuth, (req, res) => {
  try {
    const { status, reason = '' } = req.body;
    if (!USER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${USER_STATUSES.join(', ')}` });
    }
    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.email === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Cannot change status of the primary admin account' });
    }
    db.prepare('UPDATE users SET status = ?, banned_reason = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, status === 'banned' ? reason : '', req.params.id);
    if (status !== 'active') {
      db.prepare("UPDATE items SET status = 'removed' WHERE seller_id = ? AND status != 'removed'").run(req.params.id);
    }
    logAudit(req.adminId, `user_${status}`, 'user', req.params.id, { reason });
    res.json({ success: true });
  } catch (err) {
    logger.error('Update user status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/users/:id/promote', adminAuth, (req, res) => {
  try {
    const target = db.prepare('SELECT id, email, is_admin FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.email === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Cannot change role of the primary admin account' });
    }
    const next = target.is_admin ? 0 : 1;
    db.prepare('UPDATE users SET is_admin = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, req.params.id);
    logAudit(req.adminId, next ? 'admin_promoted' : 'admin_demoted', 'user', req.params.id);
    res.json({ success: true, isAdmin: !!next });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/users/:id/reset-password', adminAuth, (req, res) => {
  try {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const tempPassword = randomPassword();
    const hashed = bcrypt.hashSync(tempPassword, 10);
    db.prepare('UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hashed, req.params.id);
    logAudit(req.adminId, 'password_reset', 'user', req.params.id);
    res.json({ success: true, tempPassword });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/users/:id', adminAuth, (req, res) => {
  try {
    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.email === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Cannot delete the primary admin account' });
    }
    const uid = target.id;
    db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM favorites WHERE user_id = ? OR item_id IN (SELECT id FROM items WHERE seller_id = ?)').run(uid, uid);
    db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(uid, uid);
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?').run(uid, uid);
    db.prepare('DELETE FROM item_images WHERE item_id IN (SELECT id FROM items WHERE seller_id = ?)').run(uid);
    db.prepare('DELETE FROM items WHERE seller_id = ?').run(uid);
    db.prepare('DELETE FROM conversations WHERE buyer_id = ? OR seller_id = ?').run(uid, uid);
    db.prepare('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?)').run(uid, uid);
    db.prepare('DELETE FROM reviews WHERE reviewer_id = ? OR reviewee_id = ?').run(uid, uid);
    db.prepare('DELETE FROM payment_methods WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM templates WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM user_reports WHERE reported_user_id = ? OR reporter_id = ?').run(uid, uid);
    db.prepare('DELETE FROM reports WHERE reporter_id = ?').run(uid);
    db.prepare('DELETE FROM disputes WHERE buyer_id = ? OR seller_id = ?').run(uid, uid);
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM wallets WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM payouts WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM gift_card_designs WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM gift_cards WHERE redeemed_by = ?').run(uid);
    db.prepare('DELETE FROM transactions WHERE buyer_id = ? OR seller_id = ?').run(uid, uid);
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM password_resets WHERE email = ?').run(target.email);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
    logAudit(req.adminId, 'user_deleted', 'user', uid, { email: target.email });
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/listings', adminAuth, (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');

    const where = [];
    const params = [];
    if (q) {
      where.push('(i.title LIKE ? OR u.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (status !== 'all') {
      where.push('i.status = ?');
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM items i JOIN users u ON i.seller_id = u.id ${whereSql}`).get(...params).count;
    const items = db.prepare(`
      SELECT i.*, u.name as seller_name
      FROM items i JOIN users u ON i.seller_id = u.id
      ${whereSql} ORDER BY i.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    items.forEach(item => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').all(item.id);
      item.images = images.map(img => img.url);
    });

    res.json({ items, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('List listings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/listings/:id/status', adminAuth, (req, res) => {
  try {
    const { status } = req.body;
    db.prepare('UPDATE items SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, req.params.id);
    logAudit(req.adminId, 'listing_status_change', 'item', req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/transactions', adminAuth, (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');

    const where = [];
    const params = [];
    if (q) {
      where.push('(t.item_title LIKE ? OR buyer.name LIKE ? OR seller.name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (status !== 'all') {
      where.push('t.status = ?');
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM transactions t
      LEFT JOIN users buyer ON buyer.id = t.buyer_id
      LEFT JOIN users seller ON seller.id = t.seller_id
      ${whereSql}
    `).get(...params).count;

    const transactions = db.prepare(`
      SELECT t.id, t.item_title, t.item_image, t.amount, t.fee_amount, t.net_amount, t.status, t.method, t.created_at,
        buyer.name as buyer_name, seller.name as seller_name
      FROM transactions t
      LEFT JOIN users buyer ON buyer.id = t.buyer_id
      LEFT JOIN users seller ON seller.id = t.seller_id
      ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({ transactions, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('List transactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/reports', adminAuth, (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const q = String(req.query.q || '').trim();
    const status = String(req.query.status || 'all');
    const type = String(req.query.type || 'all');

    const statusWhere = status === 'all' ? '' : ` AND status = ?`;
    const statusParams = status === 'all' ? [] : [status];
    const itemWhere = q ? 'AND (i.title LIKE ? OR u.name LIKE ?)' : '';
    const itemParams = q ? [`%${q}%`, `%${q}%`] : [];
    const userWhere = q ? 'AND (u2.name LIKE ? OR u.name LIKE ?)' : '';
    const userParams = q ? [`%${q}%`, `%${q}%`] : [];

    const itemReports = db.prepare(`
      SELECT 'item' as type, r.id, r.reason, r.description, r.status, r.created_at,
        i.title as target, u.name as reporter_name, i.status as item_status
      FROM reports r
      JOIN items i ON i.id = r.item_id
      JOIN users u ON u.id = r.reporter_id
      WHERE 1=1 ${statusWhere} ${itemWhere}
      ORDER BY r.created_at DESC
    `).all(...statusParams, ...itemParams);

    const userReports = db.prepare(`
      SELECT 'user' as type, ur.id, ur.reason, ur.description, ur.status, ur.created_at,
        u2.name as target, u.name as reporter_name, u2.status as user_status
      FROM user_reports ur
      JOIN users u ON ur.reporter_id = u.id
      JOIN users u2 ON ur.reported_user_id = u2.id
      WHERE 1=1 ${statusWhere} ${userWhere}
      ORDER BY ur.created_at DESC
    `).all(...statusParams, ...userParams);

    let reports = [...itemReports, ...userReports];
    reports.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (type !== 'all') reports = reports.filter((r) => r.type === type);

    const total = reports.length;
    const paged = reports.slice(offset, offset + limit);

    res.json({ reports: paged, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    logger.error('List reports error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/reports/:id/resolve', adminAuth, (req, res) => {
  try {
    const { action = 'warn' } = req.body;

    let report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    let type = 'item';
    if (!report) {
      report = db.prepare('SELECT * FROM user_reports WHERE id = ?').get(req.params.id);
      type = 'user';
    }
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (action === 'dismiss') {
      if (type === 'item') {
        db.prepare("UPDATE reports SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
      } else {
        db.prepare("UPDATE user_reports SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
      }
      logAudit(req.adminId, 'report_dismissed', type === 'item' ? 'report' : 'user_report', req.params.id, { action });
      return res.json({ success: true });
    }

    if (type === 'item') {
      db.prepare("UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
      if (action === 'remove') {
        db.prepare("UPDATE items SET status = 'removed' WHERE id = ?").run(report.item_id);
      } else {
        db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(report.item_id);
      }
    } else {
      db.prepare("UPDATE user_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
      if (action === 'suspend') {
        db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(report.reported_user_id);
        db.prepare("UPDATE items SET status = 'removed' WHERE seller_id = ?").run(report.reported_user_id);
      }
    }

    logAudit(req.adminId, 'report_resolved', type === 'item' ? 'report' : 'user_report', req.params.id, { action });
    res.json({ success: true });
  } catch (err) {
    logger.error('Resolve report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/audit-logs', adminAuth, (req, res) => {
  try {
    const { page, limit, offset } = paginate(req);
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE action LIKE ? OR entity_type LIKE ?' : '';
    const params = q ? [`%${q}%`, `%${q}%`] : [];
    const total = db.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`).get(...params).count;
    const logs = db.prepare(`
      SELECT l.*, u.name as admin_name FROM audit_logs l
      LEFT JOIN users u ON u.id = l.admin_id
      ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);
    res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/export/:kind', adminAuth, (req, res) => {
  try {
    const kind = req.params.kind;
    if (kind === 'users') {
      const rows = db.prepare(`
        SELECT id, name, email, verified, is_admin, status, rating, review_count, created_at FROM users ORDER BY created_at DESC
      `).all();
      return sendCsv(res, `users-${Date.now()}.csv`,
        ['id', 'name', 'email', 'verified', 'is_admin', 'status', 'rating', 'review_count', 'created_at'], rows);
    }
    if (kind === 'transactions') {
      const rows = db.prepare(`
        SELECT t.id, t.item_title, t.amount, t.fee_amount, t.net_amount, t.status, t.method, t.created_at,
          buyer.name as buyer_name, seller.name as seller_name
        FROM transactions t
        LEFT JOIN users buyer ON buyer.id = t.buyer_id
        LEFT JOIN users seller ON seller.id = t.seller_id
        ORDER BY t.created_at DESC
      `).all();
      return sendCsv(res, `transactions-${Date.now()}.csv`,
        ['id', 'item_title', 'buyer_name', 'seller_name', 'amount', 'fee_amount', 'net_amount', 'status', 'method', 'created_at'], rows);
    }
    if (kind === 'payouts') {
      const rows = db.prepare(`
        SELECT p.id, u.name as user_name, p.amount_cents, p.fee_cents, p.method, p.status, p.created_at, p.processed_at
        FROM payouts p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC
      `).all();
      return sendCsv(res, `payouts-${Date.now()}.csv`,
        ['id', 'user_name', 'amount_cents', 'fee_cents', 'method', 'status', 'created_at', 'processed_at'], rows);
    }
    return res.status(400).json({ error: 'Invalid export type' });
  } catch (err) {
    logger.error('Export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/broadcast', adminAuth, (req, res) => {
  try {
    const { title, body, type = 'announcement' } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' });
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'Body is required' });

    const userIds = db.prepare('SELECT id FROM users').all();
    const insert = db.prepare(
      'INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)'
    );
    for (const u of userIds) {
      insert.run(uuidv4(), u.id, type, title, body);
    }
    logAudit(req.adminId, 'broadcast', 'notification', null, { title, recipients: userIds.length });
    res.json({ success: true, recipients: userIds.length });
  } catch (err) {
    logger.error('Broadcast error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/backup', adminAuth, async (req, res) => {
  try {
    const buf = await exportDatabase();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="tradehub-backup-${Date.now()}.db"`);
    logAudit(req.adminId, 'db_backup', 'database', null, { size: buf.length });
    res.send(buf);
  } catch (err) {
    logger.error('Backup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/backup', adminAuth, async (req, res) => {
  try {
    const { data } = req.body;
    if (!data || typeof data !== 'string') return res.status(400).json({ error: 'Base64 database payload required' });
    const buffer = Buffer.from(data, 'base64');
    if (buffer.length < 1000) return res.status(400).json({ error: 'Invalid database payload' });
    await replaceDatabase(buffer);
    logAudit(req.adminId, 'db_restore', 'database', null, { size: buffer.length });
    res.json({ success: true, size: buffer.length });
  } catch (err) {
    logger.error('Restore error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Platform settings -----------------------------------------------------

router.get('/settings', adminAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM platform_settings ORDER BY key').all();
    const settings = {};
    rows.forEach((r) => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings', adminAuth, (req, res) => {
  try {
    const allowed = ['site_name', 'support_email', 'maintenance_mode', 'platform_fee_percent', 'currency', 'terms_url', 'privacy_url', 'about_text'];
    const updated = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        db.prepare(`UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?`).run(String(req.body[key]), key);
        updated.push(key);
      }
    }
    logAudit(req.adminId, 'settings_update', 'platform_settings', null, { updated });
    const rows = db.prepare('SELECT * FROM platform_settings ORDER BY key').all();
    const settings = {};
    rows.forEach((r) => { settings[r.key] = r.value; });
    res.json({ success: true, settings });
  } catch (err) {
    logger.error('Update platform settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/system-info', adminAuth, async (req, res) => {
  try {
    const buf = await exportDatabase();
    const pendingReports =
      db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").get().c +
      db.prepare("SELECT COUNT(*) as c FROM user_reports WHERE status = 'pending'").get().c;
    const mem = process.memoryUsage();
    res.json({
      version: pkg.version,
      name: pkg.name,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      env: process.env.NODE_ENV || 'development',
      dbMode: process.env.NETLIFY === 'true' ? 'blob' : 'file',
      dbSize: buf.length,
      counts: {
        users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        items: db.prepare('SELECT COUNT(*) as c FROM items').get().c,
        transactions: db.prepare('SELECT COUNT(*) as c FROM transactions').get().c,
        notifications: db.prepare('SELECT COUNT(*) as c FROM notifications').get().c,
        pendingReports,
      },
      now: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('System info error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Admin refund ----------------------------------------------------------

router.post('/transactions/:txnId/refund', adminAuth, async (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.status === 'refunded') return res.status(400).json({ error: 'Transaction already refunded' });
    await refundTxn(txn);
    try {
      const buyer = db.prepare('SELECT email FROM users WHERE id = ?').get(txn.buyer_id);
      if (buyer?.email) {
        sendNotificationEmail(buyer.email, 'Refund issued', `Your payment for "${txn.item_title}" has been refunded by TradeHub.`).catch(() => {});
      }
    } catch {}
    logAudit(req.adminId, 'refund', 'transaction', txn.id, { amount: txn.amount });
    res.json({ success: true });
  } catch (err) {
    logger.error('Admin refund error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Admin promotions ------------------------------------------------------

router.get('/promotions', adminAuth, (req, res) => {
  try {
    const promotions = db.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all();
    res.json({ promotions });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/promotions', adminAuth, (req, res) => {
  try {
    const { code, discount_type, discount_value, max_uses, expires_at, min_purchase } = req.body;
    if (!code || !String(code).trim()) return res.status(400).json({ error: 'Code is required' });
    if (!['percentage', 'fixed'].includes(discount_type)) {
      return res.status(400).json({ error: 'discount_type must be percentage or fixed' });
    }
    const value = parseFloat(discount_value);
    if (isNaN(value) || value <= 0) return res.status(400).json({ error: 'Valid discount_value is required' });
    const existing = db.prepare('SELECT id FROM promotions WHERE code = ?').get(String(code).trim().toUpperCase());
    if (existing) return res.status(409).json({ error: 'Promotion code already exists' });
    const id = uuidv4();
    db.prepare(`
      INSERT INTO promotions (id, code, discount_type, discount_value, max_uses, expires_at, min_purchase)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, String(code).trim().toUpperCase(), discount_type, value, max_uses || 0, expires_at || null, min_purchase || null);
    logAudit(req.adminId, 'promotion_create', 'promotion', id, { code: String(code).trim().toUpperCase() });
    res.status(201).json({ promotion: db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) });
  } catch (err) {
    logger.error('Create admin promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/promotions/:id', adminAuth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Promotion not found' });
    const { code, discount_type, discount_value, max_uses, expires_at, min_purchase, active } = req.body;
    db.prepare(`
      UPDATE promotions SET code = ?, discount_type = ?, discount_value = ?, max_uses = ?,
        expires_at = ?, min_purchase = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      code?.trim().toUpperCase() ?? existing.code,
      discount_type ?? existing.discount_type,
      discount_value !== undefined ? parseFloat(discount_value) : existing.discount_value,
      max_uses !== undefined ? max_uses : existing.max_uses,
      expires_at !== undefined ? expires_at : existing.expires_at,
      min_purchase !== undefined ? min_purchase : existing.min_purchase,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      existing.id
    );
    logAudit(req.adminId, 'promotion_update', 'promotion', existing.id);
    res.json({ promotion: db.prepare('SELECT * FROM promotions WHERE id = ?').get(existing.id) });
  } catch (err) {
    logger.error('Update admin promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/promotions/:id', adminAuth, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Promotion not found' });
    db.prepare('DELETE FROM promotions WHERE id = ?').run(existing.id);
    logAudit(req.adminId, 'promotion_delete', 'promotion', existing.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete admin promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
