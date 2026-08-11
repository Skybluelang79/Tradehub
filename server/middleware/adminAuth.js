import jwt from 'jsonwebtoken';
import db from '../db.js';
import { requiredEnv } from '../src/env.js';

const JWT_SECRET = requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026');

export function adminAuth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    // Re-verify against the users table so demoted/removed admins lose
    // access immediately instead of relying on the JWT claim alone.
    const admin = db.prepare('SELECT id, is_admin, status FROM users WHERE id = ?').get(decoded.userId);
    if (!admin || admin.is_admin !== 1) return res.status(403).json({ error: 'Admin access revoked' });
    if (admin.status === 'banned' || admin.status === 'suspended') {
      return res.status(403).json({ error: 'Admin account is restricted' });
    }

    req.adminId = admin.id;
    req.user = { ...req.user, id: admin.id, isAdmin: true };
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}
