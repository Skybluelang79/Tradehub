import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import logger from '../src/logger.js';

const router = Router();

const ID_TYPES = ['national_id', 'passport', 'drivers_license', 'residence_permit', 'other'];

const REQUEST_COLUMNS = `
  r.id, r.user_id, r.id_type, r.id_number, r.id_image_url, r.selfie_url,
  r.status, r.admin_note, r.created_at, r.reviewed_at,
  u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar,
  u.verified AS email_verified, u.identity_verified
`;

function getLatest(userId) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM verification_requests r LEFT JOIN users u ON u.id = r.user_id WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 1`).get(userId);
}

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

// Current user's verification status.
router.get('/status', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT identity_verified FROM users WHERE id = ?').get(req.user.id);
    const latest = getLatest(req.user.id);
    res.json({
      identityVerified: !!user?.identity_verified,
      request: latest || null,
    });
  } catch (err) {
    logger.error('Verification status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Submit a seller identity verification request.
router.post('/', authenticateToken, (req, res) => {
  try {
    const { idType, idNumber, idImageUrl, selfieUrl } = req.body;
    if (!ID_TYPES.includes(idType)) {
      return res.status(400).json({ error: `idType must be one of: ${ID_TYPES.join(', ')}` });
    }
    if (!String(idNumber || '').trim()) {
      return res.status(400).json({ error: 'ID number is required' });
    }
    if (String(idNumber).trim().length > 100) {
      return res.status(400).json({ error: 'ID number too long (max 100 characters)' });
    }
    if (!String(idImageUrl || '').startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Please upload a photo of your identification document' });
    }
    if (selfieUrl && !String(selfieUrl).startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Invalid selfie upload' });
    }

    const user = db.prepare('SELECT identity_verified FROM users WHERE id = ?').get(req.user.id);
    if (user?.identity_verified) {
      return res.status(400).json({ error: 'You are already verified' });
    }

    const existing = db.prepare("SELECT id, status FROM verification_requests WHERE user_id = ? AND status = 'pending'").get(req.user.id);
    if (existing) {
      return res.status(400).json({ error: 'You already have a verification request under review' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO verification_requests (id, user_id, id_type, id_number, id_image_url, selfie_url, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(id, req.user.id, idType, String(idNumber).trim(), idImageUrl, selfieUrl || null);

    notify(req.user.id, 'verification', 'Verification Submitted',
      'Your seller verification request has been submitted and is pending review.');

    res.status(201).json({ request: getLatest(req.user.id) });
  } catch (err) {
    logger.error('Create verification error:', err);
    res.status(400).json({ error: err.message || 'Failed to submit verification request' });
  }
});

export default router;