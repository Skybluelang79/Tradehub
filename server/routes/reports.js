import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import logger from '../src/logger.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const reports = db.prepare(`
      SELECT r.*, i.title as item_title, u.name as reporter_name
      FROM reports r
      JOIN items i ON r.item_id = i.id
      JOIN users u ON r.reporter_id = u.id
      WHERE r.reporter_id = ?
      ORDER BY r.created_at DESC
    `).all(req.user.id);
    const userReports = db.prepare(`
      SELECT ur.*, u.name as reporter_name, u2.name as reported_name
      FROM user_reports ur
      JOIN users u ON ur.reporter_id = u.id
      JOIN users u2 ON ur.reported_user_id = u2.id
      WHERE ur.reporter_id = ?
      ORDER BY ur.created_at DESC
    `).all(req.user.id);
    res.json({ reports, userReports });
  } catch (err) {
    logger.error('Get reports error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { itemId, reason, description } = req.body;
    if (!itemId || !reason) {
      return res.status(400).json({ error: 'itemId and reason are required' });
    }

    const existing = db.prepare(
      'SELECT id FROM reports WHERE item_id = ? AND reporter_id = ?'
    ).get(itemId, req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'You already reported this item' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO reports (id, item_id, reporter_id, reason, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, itemId, req.user.id, reason, description || '');

    const reportCount = db.prepare('SELECT COUNT(*) as count FROM reports WHERE item_id = ?').get(itemId);
    if (reportCount.count >= 3) {
      db.prepare("UPDATE items SET status = 'flagged' WHERE id = ?").run(itemId);
    }

    res.status(201).json({ success: true, id, type: 'item' });
  } catch (err) {
    logger.error('Create report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/user', authenticateToken, (req, res) => {
  try {
    const { userId, reason, description } = req.body;
    if (!userId || !reason) {
      return res.status(400).json({ error: 'userId and reason are required' });
    }
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot report yourself' });
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    const existing = db.prepare(
      'SELECT id FROM user_reports WHERE reported_user_id = ? AND reporter_id = ?'
    ).get(userId, req.user.id);
    if (existing) {
      return res.status(409).json({ error: 'You already reported this user' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO user_reports (id, reported_user_id, reporter_id, reason, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, userId, req.user.id, reason, description || '');

    res.status(201).json({ success: true, id, type: 'user' });
  } catch (err) {
    logger.error('Create user report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/resolve', adminAuth, (req, res) => {
  try {
    const { action } = req.body;

    let report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    let type = 'item';

    if (!report) {
      report = db.prepare('SELECT * FROM user_reports WHERE id = ?').get(req.params.id);
      type = 'user';
    }

    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (type === 'item') {
      db.prepare("UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
      if (action === 'remove') {
        db.prepare("UPDATE items SET status = 'removed' WHERE id = ?").run(report.item_id);
      } else if (action === 'warn') {
        db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(report.item_id);
      }
    } else {
      db.prepare("UPDATE user_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);
      if (action === 'suspend') {
        db.prepare("UPDATE items SET status = 'removed' WHERE seller_id = ?").run(report.reported_user_id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Resolve report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
