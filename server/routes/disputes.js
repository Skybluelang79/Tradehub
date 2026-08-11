import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import validate, { createDisputeSchema } from '../src/validation.js';
import { refundTxn, getFeeRateForSeller } from './payments.js';
import logger from '../src/logger.js';

const router = Router();

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

function getWallet(userId) {
  let w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (!w) {
    db.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(userId);
    w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  }
  return w;
}

router.post('/', authenticateToken, validate(createDisputeSchema), (req, res) => {
  try {
    const { transactionId, reason, description } = req.validatedBody;

    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(transactionId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    if (txn.buyer_id !== req.user.id && txn.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your transaction' });
    }

    const existing = db.prepare(
      "SELECT id FROM disputes WHERE transaction_id = ? AND status = 'open'"
    ).get(transactionId);
    if (existing) {
      return res.status(409).json({ error: 'An open dispute already exists for this transaction' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO disputes (id, transaction_id, opened_by, reason, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, transactionId, req.user.id, reason, description);

    db.prepare("UPDATE transactions SET status = 'disputed' WHERE id = ?").run(transactionId);

    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id);
    res.status(201).json({ dispute });
  } catch (err) {
    logger.error('Create dispute error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    let disputes;
    if (req.user.isAdmin) {
      disputes = db.prepare(`
        SELECT d.*, t.item_title, t.amount, t.status as txn_status,
          buyer.name as buyer_name, seller.name as seller_name,
          opener.name as opener_name
        FROM disputes d
        JOIN transactions t ON d.transaction_id = t.id
        LEFT JOIN users buyer ON buyer.id = t.buyer_id
        LEFT JOIN users seller ON seller.id = t.seller_id
        LEFT JOIN users opener ON opener.id = d.opened_by
        ORDER BY d.created_at DESC
      `).all();
    } else {
      disputes = db.prepare(`
        SELECT d.*, t.item_title, t.amount, t.status as txn_status
        FROM disputes d
        JOIN transactions t ON d.transaction_id = t.id
        WHERE t.buyer_id = ? OR t.seller_id = ?
        ORDER BY d.created_at DESC
      `).all(req.user.id, req.user.id);
    }
    res.json({ disputes });
  } catch (err) {
    logger.error('Get disputes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const dispute = db.prepare(`
      SELECT d.*, t.item_title FROM disputes d
      JOIN transactions t ON d.transaction_id = t.id
      WHERE d.id = ?
    `).get(req.params.id);

    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(dispute.transaction_id);
    if (txn.buyer_id !== req.user.id && txn.seller_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ dispute });
  } catch (err) {
    logger.error('Get dispute error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/resolve', adminAuth, async (req, res) => {
  try {
    const { resolution, action } = req.body;
    if (!['refund_buyer', 'release_seller'].includes(action)) {
      return res.status(400).json({ error: 'Invalid resolution action' });
    }

    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    if (dispute.status !== 'open') {
      return res.status(400).json({ error: 'Dispute is already resolved' });
    }

    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(dispute.transaction_id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    const amountCents = Math.round(txn.amount * 100);
    const feeCents = Math.round(amountCents * getFeeRateForSeller(txn.seller_id));
    const netCents = amountCents - feeCents;

    if (action === 'refund_buyer') {
      await refundTxn(txn);
      notify(txn.buyer_id, 'system', 'Dispute Resolved', `Your dispute for "${txn.item_title}" was resolved. Payment of $${txn.amount} has been refunded.`);
      notify(txn.seller_id, 'system', 'Dispute Resolved', `The dispute for "${txn.item_title}" was resolved in the buyer's favor.`);
    } else if (action === 'release_seller') {
      if (txn.status !== 'completed') {
        getWallet(txn.seller_id);
        db.prepare('UPDATE wallets SET available_cents = available_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
          .run(netCents, netCents, txn.seller_id);
        db.prepare("UPDATE transactions SET status = 'completed', completed_at = datetime('now'), fee_amount = ?, net_amount = ? WHERE id = ?")
          .run(feeCents / 100, netCents / 100, dispute.transaction_id);
      }
      notify(txn.buyer_id, 'system', 'Dispute Resolved', `Your dispute for "${txn.item_title}" was resolved in the seller's favor.`);
      notify(txn.seller_id, 'system', 'Dispute Resolved', `The dispute for "${txn.item_title}" was resolved in your favor. Payment released.`);
    }

    db.prepare(`
      UPDATE disputes SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(resolution || '', req.user.id, req.params.id);

    res.json({ success: true });
  } catch (err) {
    logger.error('Resolve dispute error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
