import db from '../db.js';

// Enforces the admin-configurable maintenance mode. When enabled, all API
// traffic is blocked with 503 except for the health check, admin panel, and
// webhooks (so Stripe/etc. can still confirm in-flight payments).
export function maintenanceMode(req, res, next) {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'maintenance_mode'").get();
    if (!row || String(row.value) !== '1') return next();
  } catch {
    return next();
  }

  const p = req.path || '';
  const allowed = ['/api/health', '/api/admin', '/api/webhooks'];
  if (allowed.some((prefix) => p === prefix || p.startsWith(prefix + '/'))) {
    return next();
  }

  res.status(503).json({ error: 'Service temporarily unavailable', maintenance: true });
}
