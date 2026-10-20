import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import logger from '../src/logger.js';
import { paystack, isPaystackConfigured } from '../src/paystack.js';

const router = Router();

const PAYOUT_METHODS = ['bank'];

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

router.get('/banks', authenticateToken, async (req, res) => {
  try {
    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'Payments are not configured' });
    }
    const country = req.query.country || process.env.PAYSTACK_BANK_COUNTRY || 'nigeria';
    let banks = [];
    const c = String(country).toLowerCase();
    if (c === 'africa' || c === 'all' || c === 'all_africa') {
      const countries = ['nigeria', 'ghana', 'kenya', 'south africa', 'tanzania', 'uganda', 'zambia', 'ivory coast', 'benin', 'senegal', 'mali', 'cameroon'];
      for (const cc of countries) {
        try {
          const b = await paystack.listBanks(cc);
          if (Array.isArray(b)) {
            banks = banks.concat(b.map((x) => ({ ...x, _country: cc })));
          }
        } catch (e) {
          logger.warn(`Failed to fetch banks for ${cc}: ${e.message}`);
        }
      }
    } else if (c.includes(',')) {
      const countries = c.split(',').map((x) => x.trim());
      for (const cc of countries) {
        try {
          const b = await paystack.listBanks(cc);
          if (Array.isArray(b)) {
            banks = banks.concat(b.map((x) => ({ ...x, _country: cc })));
          }
        } catch (e) {
          logger.warn(`Failed to fetch banks for ${cc}: ${e.message}`);
        }
      }
    } else {
      banks = await paystack.listBanks(country);
    }
    res.json({ banks: banks || [], country });
  } catch (err) {
    logger.error('Get banks error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
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

// A payout moves pending -> approved -> completed, or pending/approved -> rejected.
// Anything else (e.g. re-completing or rejecting an already-completed payout)
// would double-adjust the wallet, so it is refused.
const ALLOWED_TRANSITIONS = {
  approved: ['pending'],
  rejected: ['pending', 'approved'],
  completed: ['pending', 'approved'],
};

async function initiatePayoutTransfer(payout, notes) {
  let details = {};
  try { details = JSON.parse(payout.method_details || '{}'); } catch { details = {}; }
  const accountNumber = String(details.accountNumber || '').trim();
  const bankCode = String(details.bankCode || '').trim();
  const accountName = String(details.accountName || details.bankName || '').trim() || 'TradeHub Seller';
  if (!accountNumber || !bankCode) {
    const err = new Error('Payout bank details are incomplete; cannot transfer');
    err.status = 400;
    throw err;
  }

  let recipientCode = payout.recipient_code;
  if (!recipientCode) {
    const recipient = await paystack.createTransferRecipient({
      name: accountName,
      accountNumber,
      bankCode,
      currency: payout.currency || 'NGN',
    });
    recipientCode = recipient && recipient.recipient_code;
    if (!recipientCode) {
      const err = new Error('Paystack did not return a recipient code');
      err.status = 502;
      throw err;
    }
  }

  const reference = `payout_${payout.id}`;
  const transfer = await paystack.initiateTransfer({
    amountMinor: payout.amount_cents,
    recipientCode,
    reference,
    reason: 'TradeHub payout',
  });
  const transferCode = transfer && (transfer.transfer_code || transfer.code);

  // Status stays 'approved' until Paystack confirms via webhook; the wallet's
  // pending_cents is settled then, so a failed transfer never loses money.
  db.prepare("UPDATE payouts SET status = 'approved', recipient_code = ?, transfer_code = ?, admin_notes = ? WHERE id = ?")
    .run(recipientCode, transferCode || null, notes, payout.id);

  return { transferCode, recipientCode };
}

function finalizePayout(payout, notes) {
  db.prepare("UPDATE wallets SET pending_cents = pending_cents - ?, updated_at = datetime('now') WHERE user_id = ?")
    .run(payout.amount_cents, payout.user_id);
  db.prepare("UPDATE payouts SET status = 'completed', admin_notes = ?, processed_at = datetime('now') WHERE id = ?")
    .run(notes, payout.id);
  notify(payout.user_id, 'payment', 'Payout Sent', `Your payout of ₦${(payout.amount_cents / 100).toFixed(2)} has been sent.`);
}

router.put('/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, notes = '' } = req.body;
    const payout = db.prepare('SELECT * FROM payouts WHERE id = ?').get(req.params.id);
    if (!payout) return res.status(404).json({ error: 'Payout not found' });
    if (!['approved', 'completed', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const from = payout.status;
    if (from === 'cancelled') return res.status(400).json({ error: 'This payout was cancelled by the seller' });
    const allowedFrom = ALLOWED_TRANSITIONS[status];
    if (!allowedFrom.includes(from)) {
      return res.status(409).json({ error: `Cannot change a ${from} payout to ${status}` });
    }

    if (status === 'rejected') {
      db.prepare('UPDATE wallets SET available_cents = available_cents + ?, pending_cents = pending_cents - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(payout.amount_cents, payout.amount_cents, payout.user_id);
      db.prepare("UPDATE payouts SET status = 'rejected', admin_notes = ?, processed_at = datetime('now') WHERE id = ?")
        .run(notes, payout.id);
      notify(payout.user_id, 'payment', 'Payout Rejected', `Your payout of ₦${(payout.amount_cents / 100).toFixed(2)} was rejected.`);
      return res.json({ success: true, payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout.id) });
    }

    if (status === 'approved') {
      db.prepare("UPDATE payouts SET status = 'approved', admin_notes = ? WHERE id = ?").run(notes, payout.id);
      return res.json({ success: true, payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout.id) });
    }

    // status === 'completed': actually move the money.
    if (isPaystackConfigured()) {
      const result = await initiatePayoutTransfer(payout, notes);
      return res.json({
        success: true,
        pending: true,
        message: 'Transfer initiated with Paystack; wallet settles when the transfer completes.',
        payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout.id),
        ...result,
      });
    }

    finalizePayout(payout, notes);
    return res.json({ success: true, payout: db.prepare('SELECT * FROM payouts WHERE id = ?').get(payout.id) });
  } catch (err) {
    logger.error('Update payout status error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
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
