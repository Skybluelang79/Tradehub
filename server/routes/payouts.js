import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import logger from '../src/logger.js';

const router = Router();

const PAYOUT_METHODS = ['bank', 'crypto', 'paypal'];

function getWallet(userId) {
  let w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (!w) {
    db.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(userId);
    w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  }
  return w;
}

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

router.get('/balance', authenticateToken, (req, res) => {
  try {
    const wallet = getWallet(req.user.id);
    res.json({ wallet });
  } catch (err) {
    logger.error('Get payout balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    const payouts = db.prepare('SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ payouts });
  } catch (err) {
    logger.error('Get payouts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { amountCents, method, details } = req.body;
    const amount = Math.round(Number(amountCents));
    if (!amount || amount < 100) return res.status(400).json({ error: 'Amount must be at least $1.00' });
    if (!PAYOUT_METHODS.includes(method)) return res.status(400).json({ error: 'Invalid payout method' });
    if (!details || (typeof details !== 'object')) return res.status(400).json({ error: 'Payout details required' });

    const wallet = getWallet(req.user.id);
    if (wallet.available_cents < amount) {
      return res.status(400).json({ error: 'Insufficient available balance' });
    }

    db.prepare("UPDATE wallets SET available_cents = available_cents - ?, pending_cents = pending_cents + ?, updated_at = datetime('now') WHERE user_id = ?")
      .run(amount, amount, req.user.id);

    const id = uuidv4();
    db.prepare(`
      INSERT INTO payouts (id, user_id, amount_cents, method, method_details, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, req.user.id, amount, method, JSON.stringify(details));

    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(id);
    res.status(201).json({ payout });
  } catch (err) {
    logger.error('Request payout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/cancel', authenticateToken, (req, res) => {
  try {
    const payout = db.prepare('SELECT * FROM payouts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (payout.status !== 'pending') return res.status(400).json({ error: 'Only pending payouts can be cancelled' });
    db.prepare("UPDATE payouts SET status = 'cancelled' WHERE id = ?").run(payout.id);
    db.prepare('UPDATE wallets SET available_cents = available_cents + ?, pending_cents = pending_cents - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(payout.amount_cents, payout.amount_cents, payout.user_id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Cancel payout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/status', adminAuth, (req, res) => {
  try {
    const { status, notes = '' } = req.body;
    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(req.params.id);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (!['approved', 'completed', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    if (status === 'rejected' && payout.status !== 'rejected') {
      db.prepare('UPDATE wallets SET available_cents = available_cents + ?, pending_cents = pending_cents - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(payout.amount_cents, payout.amount_cents, payout.user_id);
      notify(payout.user_id, 'payment', 'Payout Rejected', `Your payout of $${(payout.amount_cents / 100).toFixed(2)} was rejected.`);
    }
    if (status === 'completed') {
      db.prepare("UPDATE wallets SET pending_cents = pending_cents - ?, updated_at = datetime('now') WHERE user_id = ?")
        .run(payout.amount_cents, payout.user_id);
      notify(payout.user_id, 'payment', 'Payout Sent', `Your payout of $${(payout.amount_cents / 100).toFixed(2)} has been sent.`);
    }

    db.prepare("UPDATE payouts SET status = ?, admin_notes = ?, processed_at = datetime('now') WHERE id = ?")
      .run(status, notes, payout.id);
    res.json({ success: true, payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout.id) });
  } catch (err) {
    logger.error('Update payout status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/all', adminAuth, (req, res) => {
  try {
    const payouts = db.prepare(`
      SELECT p.*, u.name as user_name, u.email as user_email
      FROM payouts p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
    `).all();
    res.json({ payouts });
  } catch (err) {
    logger.error('List all payouts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
