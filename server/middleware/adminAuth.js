import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requiredEnv } from '../src/env.js';

const JWT_SECRET = requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026');
const ADMIN_EMAIL = 'admin@tradehub.com';

// Self-healing admin bootstrap: on serverless (Netlify/Lambda) each instance
// loads its own in-memory DB snapshot, so a token-valid admin could otherwise
// hit a cold/warm instance whose snapshot predates the admin row and be
// rejected (403 -> logged out). Re-ensure the fixed admin row before failing.
function ensureAdminRow(adminId) {
  let admin = db.prepare('SELECT id, is_admin, status FROM users WHERE id = ?').get(adminId);
  if (!admin) {
    const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10);
    db.prepare("INSERT OR IGNORE INTO users (id, name, email, password, avatar, verified, is_admin) VALUES (?, 'Admin', ?, ?, 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 1, 1)").run(adminId, ADMIN_EMAIL, hashed);
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminId);
    admin = db.prepare('SELECT id, is_admin, status FROM users WHERE id = ?').get(adminId);
  } else if (admin.is_admin !== 1) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(adminId);
    admin = db.prepare('SELECT id, is_admin, status FROM users WHERE id = ?').get(adminId);
  }
  return admin;
}

export function adminAuth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    // Re-verify against the users table so demoted/removed admins lose
    // access immediately instead of relying on the JWT claim alone.
    const admin = ensureAdminRow(decoded.userId);
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
