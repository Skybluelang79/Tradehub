import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import logger from '../src/logger.js';

const router = Router();

const REWARD_CENTS = 1000;

function sanitizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateReferralCode(userId, name) {
  const base = sanitizeCode((name || '').split(/\s+/)[0] || 'USER').slice(0, 8) || 'USER';
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  let code = `${base}${random}`.slice(0, 12);
  let attempts = 0;
  while (db.prepare("SELECT id FROM users WHERE referral_code = ?").get(code) && attempts < 5) {
    code = `${base}${Math.random().toString(36).slice(2, 5).toUpperCase()}`.slice(0, 12);
    attempts += 1;
  }
  return code;
}

export function ensureReferralCode(userId, name) {
  if (!userId) return '';
  const user = db.prepare('SELECT referral_code, name FROM users WHERE id = ?').get(userId);
  if (!user) return '';
  if (user.referral_code) return user.referral_code;
  const code = generateReferralCode(userId, user.name || name || 'USER');
  db.prepare("UPDATE users SET referral_code = ? WHERE id = ?").run(code, userId);
  return code;
}

export function applyReferral(referredId, rawCode) {
  const code = sanitizeCode(rawCode);
  if (!code || !referredId) return false;
  const referrer = db.prepare("SELECT id FROM users WHERE referral_code = ?").get(code);
  if (!referrer || referrer.id === referredId) return false;
  const already = db.prepare('SELECT id FROM referrals WHERE referred_id = ?').get(referredId);
  if (already) return false;
  const id = uuidv4();
  db.prepare(`
    INSERT INTO referrals (id, referrer_id, referred_id, code, status, reward_cents)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, referrer.id, referredId, code, REWARD_CENTS);
  try {
    db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), referrer.id, 'referral', 'New Referral',
        'Someone joined TradeHub using your link. You will earn store credit once they complete their first purchase.');
  } catch (err) {
    logger.error('Referral notify error:', err);
  }
  return true;
}

// First completed purchase: credit the referrer's wallet and mark the referral done.
export function creditFirstPurchase(userId) {
  const referral = db.prepare("SELECT * FROM referrals WHERE referred_id = ? AND status = 'pending'").get(userId);
  if (!referral) return;
  // Only the FIRST completed transaction triggers credit.
  const completed = db.prepare("SELECT COUNT(*) as c FROM transactions WHERE buyer_id = ? AND status = 'completed'").get(userId).c;
  if (completed > 1) return;

  const wallet = db.prepare('SELECT available_cents FROM wallets WHERE user_id = ?').get(referral.referrer_id);
  const available = (wallet?.available_cents || 0) + referral.reward_cents;
  db.prepare(`
    INSERT INTO wallets (user_id, available_cents, lifetime_cents)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      available_cents = available_cents + ?,
      lifetime_cents = lifetime_cents + ?
  `).run(referral.referrer_id, available, available, referral.reward_cents, referral.reward_cents);

  db.prepare("UPDATE referrals SET status = 'credited', credited_at = datetime('now') WHERE id = ?").run(referral.id);

  try {
    db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), referral.referrer_id, 'referral', 'Referral Reward Earned',
        `You earned $${(referral.reward_cents / 100).toFixed(2)} store credit from your referral!`);
  } catch (err) {
    logger.error('Referral credit notify error:', err);
  }
}

// My referral info: code, link, signed-up count, credits earned.
router.get('/my', authenticateToken, (req, res) => {
  try {
    const code = ensureReferralCode(req.user.id);
    const referred = db.prepare('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?').get(req.user.id).c;
    const credited = db.prepare("SELECT COALESCE(SUM(reward_cents), 0) as c FROM referrals WHERE referrer_id = ? AND status = 'credited'").get(req.user.id).c;
    const list = db.prepare(`
      SELECT r.code, r.reward_cents, r.status, r.created_at, u.name AS referred_name, u.avatar AS referred_avatar
      FROM referrals r LEFT JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = ? ORDER BY r.created_at DESC
    `).all(req.user.id);
    res.json({
      code,
      rewardCents: REWARD_CENTS,
      referredCount: referred,
      earnedCents: credited,
      list,
    });
  } catch (err) {
    logger.error('Referrals status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/code', authenticateToken, (req, res) => {
  try {
    const code = ensureReferralCode(req.user.id);
    res.json({ code });
  } catch (err) {
    logger.error('Referral code error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;