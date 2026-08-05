import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import logger from '../src/logger.js';

const router = Router();
const ADMIN_EMAIL = 'admin@tradehub.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function adminAuth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin token required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tradehub-secret-key-change-in-production-2026');
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    req.adminId = decoded.userId;
    req.user = { ...req.user, isAdmin: true };
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
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

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid admin credentials' });
  }
  let admin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (!admin) {
    const id = 'admin-1';
    const hashed = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.prepare("INSERT INTO users (id, name, email, password, avatar, verified) VALUES (?, 'Admin', ?, ?, 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 1)").run(id, ADMIN_EMAIL, hashed);
    admin = { id };
  }
  const token = jwt.sign(
    { userId: admin.id, isAdmin: true },
    process.env.JWT_SECRET || 'tradehub-secret-key-change-in-production-2026',
    { expiresIn: '24h' }
  );
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
    const openDisputes = db.prepare("SELECT COUNT(*) as count FROM disputes WHERE status = 'open'").get().count;
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

    res.json({
      stats: { totalUsers, totalItems, activeItems, totalTransactions, totalRevenue, totalFees, pendingReports, openDisputes, pendingVerifications, totalViews, pendingPayouts, paidOut, activeWallets, giftCardsIssued, giftCardsRedeemed },
      recentUsers, recentItems, topViewedItems, recentTransactions, revenueByDay, topCategories, userSignupsByDay,
    });
  } catch (err) {
    logger.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/users', adminAuth, (req, res) => {
  try {
    const users = db.prepare('SELECT id, name, email, avatar, verified, rating, review_count, created_at FROM users ORDER BY created_at DESC').all();
    res.json({ users });
  } catch (err) {
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

router.delete('/users/:id', adminAuth, (req, res) => {
  try {
    db.prepare("UPDATE items SET status = 'removed' WHERE seller_id = ?").run(req.params.id);
    logAudit(req.adminId, 'user_suspended', 'user', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/listings', adminAuth, (req, res) => {
  try {
    const items = db.prepare(`
      SELECT i.*, u.name as seller_name FROM items i
      JOIN users u ON i.seller_id = u.id
      ORDER BY i.created_at DESC
    `).all();
    items.forEach(item => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').all(item.id);
      item.images = images.map(img => img.url);
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/listings/:id/status', adminAuth, (req, res) => {
  try {
    const { status } = req.body;
    db.prepare('UPDATE items SET status = ? WHERE id = ?').run(status, req.params.id);
    logAudit(req.adminId, 'listing_status_change', 'item', req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/transactions', adminAuth, (req, res) => {
  try {
    const transactions = db.prepare('SELECT * FROM transactions ORDER BY created_at DESC').all();
    res.json({ transactions });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/audit-logs', adminAuth, (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const logs = db.prepare(`
      SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(parseInt(limit), offset);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
