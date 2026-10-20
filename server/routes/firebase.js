import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { verifyFirebaseToken, sendPushNotification } from '../src/firebase.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { sendNotificationEmail } from '../src/email.js';

const router = Router();

router.post('/signup', async (req, res) => {
  try {
    const { idToken, name } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Firebase ID token is required' });

    const decoded = await verifyFirebaseToken(idToken);
    if (!decoded) return res.status(401).json({ error: 'Invalid Firebase token' });

    let user = db.prepare('SELECT * FROM users WHERE firebase_uid = ? OR email = ?').get(decoded.uid, decoded.email);

    if (user) {
      if (!user.firebase_uid) {
        db.prepare('UPDATE users SET firebase_uid = ?, auth_provider = ? WHERE id = ?').run(decoded.uid, 'firebase', user.id);
      }
      const token = generateToken(user.id);
      const userData = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, location_lat, location_lng, location_address, created_at FROM users WHERE id = ?').get(user.id);
      return res.json({ token, user: userData });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(uuidv4(), 10);
    const displayName = name || decoded.name || decoded.email?.split('@')[0] || 'User';
    const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(displayName)}`;

    db.prepare(`
      INSERT INTO users (id, name, email, password, avatar, verified, firebase_uid, auth_provider)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'firebase')
    `).run(id, displayName, decoded.email, hashedPassword, avatar, decoded.email_verified ? 1 : 0, decoded.uid);

    db.prepare('INSERT INTO user_settings (user_id) VALUES (?)').run(id);
    db.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(id);

    const newUser = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, location_lat, location_lng, location_address, created_at FROM users WHERE id = ?').get(id);
    const token = generateToken(id);

    res.status(201).json({ token, user: newUser });
  } catch (err) {
    console.error('Firebase signup error:', err);
    res.status(500).json({ error: 'Firebase signup failed' });
  }
});

router.post('/link', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const jwtToken = authHeader && authHeader.split(' ')[1];
    if (!jwtToken) return res.status(401).json({ error: 'JWT token required' });

    const jwt = await import('jsonwebtoken');
    const { requiredSecret } = await import('../src/env.js');
    const JWT_SECRET = requiredSecret('JWT_SECRET');
    const decoded = jwt.default.verify(jwtToken, JWT_SECRET);

    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'Firebase ID token is required' });

    const fbDecoded = await verifyFirebaseToken(idToken);
    if (!fbDecoded) return res.status(401).json({ error: 'Invalid Firebase token' });

    db.prepare('UPDATE users SET firebase_uid = ?, auth_provider = ? WHERE id = ?').run(fbDecoded.uid, 'firebase', decoded.userId);

    res.json({ success: true, message: 'Firebase account linked' });
  } catch (err) {
    console.error('Firebase link error:', err);
    res.status(500).json({ error: 'Failed to link Firebase account' });
  }
});

// Both outbound-notification endpoints require a signed-in caller: without a
// guard they are an open relay (anyone could mail arbitrary addresses or push
// to arbitrary device tokens). Even authenticated, a non-admin may only send to
// their own address / device; admins may still target explicitly.
router.post('/send-email', authenticateToken, async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }
    const me = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const recipient = req.user.isAdmin && to ? to : me?.email;
    if (!recipient) return res.status(400).json({ error: 'No recipient email on file' });
    await sendNotificationEmail(recipient, subject, body);
    res.json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Firebase send-email error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

router.post('/push', authenticateToken, async (req, res) => {
  try {
    const { tokens, title, body, image, data } = req.body;
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }
    let targets = tokens;
    if (!req.user.isAdmin) {
      const settings = db.prepare('SELECT fcm_token FROM user_settings WHERE user_id = ?').get(req.user.id);
      targets = settings?.fcm_token ? [settings.fcm_token] : [];
    }
    if (!Array.isArray(targets)) targets = targets ? [targets] : [];
    if (!targets.length) return res.status(400).json({ error: 'No push device registered for this account' });
    const result = await sendPushNotification(targets, { title, body, image, data });
    res.json({ success: true, result });
  } catch (err) {
    console.error('Firebase push error:', err);
    res.status(500).json({ error: 'Failed to send push notification' });
  }
});

export default router;
