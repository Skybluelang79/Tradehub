import { Router } from 'express';
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

router.get('/platform', (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM platform_settings WHERE key IN ('site_name','support_email','maintenance_mode','platform_fee_percent','currency','terms_url','privacy_url','about_text')").all();
    const settings = {};
    rows.forEach((r) => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch (err) {
    logger.error('Get platform settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    const booleanKeys = [
      'notifications', 'dark_mode', 'location_enabled',
      'notif_messages', 'notif_price_drops', 'notif_followers', 'notif_boosts',
    ];
    const allowed = [...booleanKeys, 'distance_unit', 'language', 'profile_visibility'];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const value = booleanKeys.includes(key) ? (req.body[key] ? 1 : 0) : req.body[key];
        db.prepare(`UPDATE user_settings SET ${key} = ?, updated_at = datetime('now') WHERE user_id = ?`).run(value, req.user.id);
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
