import jwt from 'jsonwebtoken';
import db from '../db.js';
import { requiredEnv } from '../src/env.js';

const JWT_SECRET = requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026');

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, location_lat, location_lng, location_address, status, is_admin AS isAdmin, created_at FROM users WHERE id = ?').get(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.status === 'banned') {
      return res.status(403).json({ error: 'Your account has been banned' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Your account has been suspended' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, location_lat, location_lng, location_address, status, is_admin AS isAdmin, created_at FROM users WHERE id = ?').get(decoded.userId);
    req.user = user && user.status === 'active' ? user : null;
  } catch (err) {
    req.user = null;
  }

  next();
}

export function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
