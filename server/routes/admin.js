import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';

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
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
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
  const token = jwt.sign({ userId: admin.id, isAdmin: true }, process.env.JWT_SECRET || 'tradehub-secret-key-change-in-production-2026', { expiresIn: '24h' });
  res.json({ token });
});

router.get('/dashboard', adminAuth, (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalItems = db.prepare('SELECT COUNT(*) as count FROM items').get().count;
    const activeItems = db.prepare("SELECT COUNT(*) as count FROM items WHERE status = 'active'").get().count;
    const totalTransactions = db.prepare('SELECT COUNT(*) as count FROM transactions').get().count;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'completed'").get().total;
    const pendingReports = db.prepare("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'").get().count;
    const recentUsers = db.prepare('SELECT id, name, email, avatar, created_at FROM users ORDER BY created_at DESC LIMIT 5').all();
    const recentItems = db.prepare('SELECT id, title, price, status, created_at FROM items ORDER BY created_at DESC LIMIT 5').all();

    res.json({
      stats: { totalUsers, totalItems, activeItems, totalTransactions, totalRevenue, pendingReports },
      recentUsers,
      recentItems,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/users/:id', adminAuth, (req, res) => {
  try {
    db.prepare("UPDATE items SET status = 'removed' WHERE seller_id = ?").run(req.params.id);
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

export default router;
