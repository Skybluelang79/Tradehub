import { Router } from 'express';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.post('/fcm-token', authenticateToken, (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'FCM token is required' });
    }

    db.prepare(`
      INSERT INTO user_settings (user_id, fcm_token, created_at, updated_at)
      VALUES (?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        fcm_token = excluded.fcm_token,
        updated_at = excluded.updated_at
    `).run(req.user.id, token);

    res.json({ success: true });
  } catch (err) {
    console.error('Save FCM token error:', err);
    res.status(500).json({ error: 'Failed to save FCM token' });
  }
});

router.delete('/fcm-token', authenticateToken, (req, res) => {
  try {
    db.prepare(`
      UPDATE user_settings SET fcm_token = NULL, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(req.user.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove FCM token' });
  }
});

export default router;
