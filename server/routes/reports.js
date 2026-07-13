import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const reports = db.prepare(`
      SELECT r.*, i.title as item_title, u.name as reporter_name
      FROM reports r
      JOIN items i ON r.item_id = i.id
      JOIN users u ON r.reporter_id = u.id
      ORDER BY r.created_at DESC
    `).all();
    res.json({ reports });
  } catch (err) {
    console.error('Get reports error:', err);
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

    res.status(201).json({ success: true, id });
  } catch (err) {
    console.error('Create report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/resolve', authenticateToken, (req, res) => {
  try {
    const { action } = req.body;
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });

    db.prepare("UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?").run(req.params.id);

    if (action === 'remove') {
      db.prepare("UPDATE items SET status = 'removed' WHERE id = ?").run(report.item_id);
    } else if (action === 'warn') {
      db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(report.item_id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Resolve report error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
