import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { convert, formatMoney } from '../../shared/currencies.js';
import { DEFAULT_CURRENCY } from '../src/paystack.js';
import { adminAuth } from '../middleware/adminAuth.js';
import validate, { createDisputeSchema } from '../src/validation.js';
import { refundTxn, getFeeRateForSeller } from './payments.js';
import { creditFirstPurchase } from './referrals.js';
import { writeLimiter } from '../src/rateLimiter.js';
import logger from '../src/logger.js';

const router = Router();

const EVIDENCE_HOURS = Math.max(1, Math.min(Number(process.env.DISPUTE_EVIDENCE_HOURS) || 72, 720));
const EVIDENCE_TYPES = ['text', 'image', 'file', 'link'];

function deadlinePassed(value) {
  if (!value) return false;
  const timestamp = new Date(`${String(value).replace(' ', 'T')}Z`).getTime();
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

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
      INSERT INTO disputes (id, transaction_id, opened_by, reason, description, evidence_deadline)
      VALUES (?, ?, ?, ?, ?, datetime('now', ?))
    `).run(id, transactionId, req.user.id, reason, description, `+${EVIDENCE_HOURS} hours`);

    db.prepare("UPDATE transactions SET status = 'disputed' WHERE id = ?").run(transactionId);

    const otherId = txn.buyer_id === req.user.id ? txn.seller_id : txn.buyer_id;
    notify(otherId, 'dispute', 'Dispute Opened', `A dispute was opened for "${txn.item_title}". You can add evidence within ${EVIDENCE_HOURS} hours.`);

    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id);
    res.status(201).json({ dispute, evidenceDeadline: dispute.evidence_deadline, evidenceWindowHours: EVIDENCE_HOURS });
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
          (SELECT COUNT(*) FROM dispute_evidence e WHERE e.dispute_id = d.id) AS evidence_count,
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
        SELECT d.*, t.item_title, t.amount, t.status as txn_status,
          (SELECT COUNT(*) FROM dispute_evidence e WHERE e.dispute_id = d.id) AS evidence_count
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

    const evidence = db.prepare(`
      SELECT e.*, u.name AS user_name, u.avatar AS user_avatar
      FROM dispute_evidence e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.dispute_id = ? ORDER BY e.created_at ASC
    `).all(dispute.id);

    res.json({
      dispute,
      evidence,
      evidenceWindowOpen: dispute.status === 'open' && !deadlinePassed(dispute.evidence_deadline),
      evidenceWindowHours: EVIDENCE_HOURS,
    });
  } catch (err) {
    logger.error('Get dispute error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/evidence', authenticateToken, writeLimiter, (req, res) => {
  try {
    const { type = 'text', content = '', url = '', filename = '' } = req.body || {};
    if (!EVIDENCE_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${EVIDENCE_TYPES.join(', ')}` });
    }

    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(dispute.transaction_id);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.buyer_id !== req.user.id && txn.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the buyer or seller can add evidence' });
    }
    if (dispute.status !== 'open') {
      return res.status(400).json({ error: 'This dispute is already resolved' });
    }
    if (deadlinePassed(dispute.evidence_deadline)) {
      return res.status(403).json({ error: 'The evidence window has closed', code: 'evidence_closed' });
    }

    const text = String(content || '').trim();
    const link = String(url || '').trim();
    if (type === 'text' && !text) {
      return res.status(400).json({ error: 'Describe the evidence you are submitting' });
    }
    if (type !== 'text' && !/^(\/uploads\/|https?:\/\/)/.test(link)) {
      return res.status(400).json({ error: 'Upload a file or provide a valid link' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Evidence description is too long (max 2000 characters)' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO dispute_evidence (id, dispute_id, user_id, type, content, url, filename)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, dispute.id, req.user.id, type, text.slice(0, 2000), link.slice(0, 2000), String(filename || '').slice(0, 200));

    const otherId = txn.buyer_id === req.user.id ? txn.seller_id : txn.buyer_id;
    notify(otherId, 'dispute', 'New Dispute Evidence', `New evidence was added to the dispute for "${txn.item_title}".`);

    const item = db.prepare(`
      SELECT e.*, u.name AS user_name, u.avatar AS user_avatar
      FROM dispute_evidence e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.id = ?
    `).get(id);
    res.status(201).json({ evidence: item });
  } catch (err) {
    logger.error('Add dispute evidence error:', err);
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

    const amountCents = Math.round(convert(txn.amount, txn.currency || DEFAULT_CURRENCY, 'NGN') * 100);
    const feeRate = getFeeRateForSeller(txn.seller_id);
    const feeCents = Math.round(amountCents * feeRate);
    const netCents = amountCents - feeCents;
    const feePercent = Math.round(feeRate * 1000) / 10;

    if (action === 'refund_buyer') {
      await refundTxn(txn);
      notify(txn.buyer_id, 'system', 'Dispute Resolved', `Your dispute for "${txn.item_title}" was resolved. Payment of ${formatMoney(txn.amount, txn.currency)} has been refunded.`);
      notify(txn.seller_id, 'system', 'Dispute Resolved', `The dispute for "${txn.item_title}" was resolved in the buyer's favor.`);
    } else if (action === 'release_seller') {
      if (txn.status !== 'completed') {
        getWallet(txn.seller_id);
        db.prepare('UPDATE wallets SET available_cents = available_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
          .run(netCents, netCents, txn.seller_id);
        db.prepare("UPDATE transactions SET status = 'completed', completed_at = datetime('now'), fee_amount = ?, net_amount = ? WHERE id = ?")
          .run(feeCents / 100, netCents / 100, dispute.transaction_id);
        creditFirstPurchase(txn.buyer_id);
      }
      notify(txn.buyer_id, 'system', 'Dispute Resolved', `Your dispute for "${txn.item_title}" was resolved in the seller's favor.`);
      notify(txn.seller_id, 'system', 'Dispute Resolved', `The dispute for "${txn.item_title}" was resolved in your favor. ${formatMoney(netCents / 100)} was released to your wallet after the ${feePercent}% platform fee (${formatMoney(feeCents / 100)}).`);
    }

    const evidenceCount = db.prepare('SELECT COUNT(*) AS count FROM dispute_evidence WHERE dispute_id = ?').get(dispute.id).count;
    const autoNote = `Auto-generated ruling summary: ${evidenceCount} evidence item(s) reviewed. Decision: ${action === 'refund_buyer' ? 'buyer refunded' : 'seller paid'}.`;
    const finalResolution = [String(resolution || '').trim(), autoNote].filter(Boolean).join('\n\n');

    db.prepare(`
      UPDATE disputes SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(finalResolution, req.user.id, req.params.id);

    res.json({ success: true, resolution: finalResolution });
  } catch (err) {
    logger.error('Resolve dispute error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
