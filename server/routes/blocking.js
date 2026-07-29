import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import validate, { blockUserSchema } from '../src/validation.js';
import logger from '../src/logger.js';

const router = Router();

router.post('/block', authenticateToken, validate(blockUserSchema), (req, res) => {
  try {
    const { userId } = req.validatedBody;

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    const existing = db.prepare(
      'SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?'
    ).get(req.user.id, userId);

    if (existing) {
      return res.status(409).json({ error: 'User already blocked' });
    }

    db.prepare('INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(req.user.id, userId);
    res.json({ success: true, blocked: true });
  } catch (err) {
    logger.error('Block user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/unblock', authenticateToken, validate(blockUserSchema), (req, res) => {
  try {
    const { userId } = req.validatedBody;
    db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, userId);
    res.json({ success: true, blocked: false });
  } catch (err) {
    logger.error('Unblock user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/blocked', authenticateToken, (req, res) => {
  try {
    const blocked = db.prepare(`
      SELECT b.blocked_id as id, u.name, u.avatar, b.created_at
      FROM blocked_users b JOIN users u ON b.blocked_id = u.id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC
    `).all(req.user.id);
    res.json({ blocked });
  } catch (err) {
    logger.error('Get blocked users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/check/:userId', authenticateToken, (req, res) => {
  try {
    const blocked = db.prepare(
      'SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?'
    ).get(req.user.id, req.params.userId);
    res.json({ blocked: !!blocked });
  } catch (err) {
    logger.error('Check blocked error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
