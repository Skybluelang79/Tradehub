import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import logger from '../src/logger.js';

const router = Router();

function getUserSettings(userId) {
  let settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  if (!settings) {
    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(userId);
    settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
  }
  return settings;
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const settings = getUserSettings(req.user.id);
    res.json({ settings });
  } catch (err) {
    logger.error('Get settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/', authenticateToken, (req, res) => {
  try {
    const allowed = ['notifications', 'dark_mode', 'location_enabled', 'distance_unit', 'language', 'profile_visibility'];
    const updates = [];
    const params = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (['notifications', 'dark_mode', 'location_enabled'].includes(key)) {
          db.prepare(`UPDATE user_settings SET ${key} = ?, updated_at = datetime('now') WHERE user_id = ?`).run(req.body[key] ? 1 : 0, req.user.id);
        } else {
          db.prepare(`UPDATE user_settings SET ${key} = ?, updated_at = datetime('now') WHERE user_id = ?`).run(req.body[key], req.user.id);
        }
      }
    }

    const settings = getUserSettings(req.user.id);
    res.json({ settings });
  } catch (err) {
    logger.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
