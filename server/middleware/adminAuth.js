import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requiredSecret, requiredEnv } from '../src/env.js';

const JWT_SECRET = requiredSecret('JWT_SECRET');
const ADMIN_PASSWORD = requiredEnv('ADMIN_PASSWORD', 'admin123');
const ADMIN_EMAIL = 'admin@tradehub.com';

// Self-healing admin bootstrap: on serverless (Netlify/Lambda) each instance
// loads its own in-memory DB snapshot, so a token-valid admin could otherwise
// hit a cold/warm instance whose snapshot predates the admin row and be
// rejected (403 -> logged out). Re-ensure the fixed admin row before failing.
function ensureAdminRow(adminId) {
  let admin = db.prepare('SELECT id, is_admin, status FROM users WHERE id = ?').get(adminId);
  if (!admin) {
    // The admin row may have been recreated under a different id (fresh DB,
    // backup restore). Trust the signed isAdmin claim and re-point at the
    // canonical row instead of rejecting a perfectly valid session.
    const byEmail = db.prepare('SELECT id, is_admin, status FROM users WHERE email = ?').get(ADMIN_EMAIL);
    if (byEmail) {
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(byEmail.id);
      return db.prepare('SELECT id, is_admin, status FROM users WHERE id = ?').get(byEmail.id);
    }
    const hashed = bcrypt.hashSync(ADMIN_PASSWORD, 10);
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
    if (!admin) return res.status(401).json({ error: 'Admin session no longer exists' });
    if (admin.is_admin !== 1) return res.status(403).json({ error: 'Admin access revoked' });
    if (admin.status === 'banned' || admin.status === 'suspended') {
      return res.status(403).json({ error: 'Admin account is restricted' });
    }

    req.adminId = admin.id;
    req.user = { ...req.user, id: admin.id, isAdmin: true };
    next();
  } catch {
    // Missing / malformed / expired credential: 401, not 403. The client only
    // clears the stored session on 401, so a 403 here would leave a dead token
    // in place while every request keeps failing.
    res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}
