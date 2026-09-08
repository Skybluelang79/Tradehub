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
      INSERT OR REPLACE INTO user_settings (user_id, fcm_token, updated_at)
      VALUES (?, ?, datetime('now'))
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
