import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'tradehub-secret-key-change-in-production-2026';

export function adminAuth(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Admin token required' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    req.adminId = decoded.userId;
    req.user = { ...req.user, isAdmin: true };
    next();
  } catch {
    res.status(403).json({ error: 'Invalid token' });
  }
}
