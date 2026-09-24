import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { verifyFirebaseToken, sendPushNotification } from '../src/firebase.js';
import { generateToken } from '../middleware/auth.js';
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
    const { requiredEnv } = await import('../src/env.js');
    const JWT_SECRET = requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026');
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

router.post('/send-email', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }
    await sendNotificationEmail(to, subject, body);
    res.json({ success: true, message: 'Email sent' });
  } catch (err) {
    console.error('Firebase send-email error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

router.post('/push', async (req, res) => {
  try {
    const { tokens, title, body, image, data } = req.body;
    if (!tokens || !title || !body) {
      return res.status(400).json({ error: 'tokens, title, and body are required' });
    }
    const result = await sendPushNotification(tokens, { title, body, image, data });
    res.json({ success: true, result });
  } catch (err) {
    console.error('Firebase push error:', err);
    res.status(500).json({ error: 'Failed to send push notification' });
  }
});

export default router;
