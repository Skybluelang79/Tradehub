import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import validate, { createDisputeSchema } from '../src/validation.js';
import logger from '../src/logger.js';

const router = Router();

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
        SELECT d.*, t.item_title FROM disputes d
        JOIN transactions t ON d.transaction_id = t.id
        ORDER BY d.created_at DESC
      `).all();
    } else {
      disputes = db.prepare(`
        SELECT d.*, t.item_title FROM disputes d
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

router.put('/:id/resolve', authenticateToken, (req, res) => {
  try {
    const { resolution, action } = req.body;

    const dispute = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    if (dispute.status !== 'open') {
      return res.status(400).json({ error: 'Dispute is already resolved' });
    }

    db.prepare(`
      UPDATE disputes SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now')
      WHERE id = ?
    `).run(resolution || '', req.user.id, req.params.id);

    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(dispute.transaction_id);

    if (action === 'refund_buyer') {
      db.prepare("UPDATE transactions SET status = 'refunded' WHERE id = ?").run(dispute.transaction_id);
      db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(txn.item_id);
    } else if (action === 'release_seller') {
      db.prepare("UPDATE transactions SET status = 'completed' WHERE id = ?").run(dispute.transaction_id);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Resolve dispute error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
