import { Router } from 'express';
import express from 'express';
import crypto from 'node:crypto';
import db from '../db.js';
import { verifyPaystackWebhook } from '../src/paystack.js';
import { refundTxn } from './payments.js';
import { activatePlan } from './subscriptions.js';
import logger from '../src/logger.js';

const router = Router();

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, type, title, body);
}

// Paystack webhook handler. Requires PAYSTACK_WEBHOOK_SECRET to be configured;
// requests without a valid signature are rejected (HMAC-SHA512).
router.post('/paystack', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.PAYSTACK_WEBHOOK_SECRET) {
    logger.error('Paystack webhook rejected: PAYSTACK_WEBHOOK_SECRET not configured');
    return res.status(503).json({ error: 'Paystack webhook secret not configured' });
  }

  if (!verifyPaystackWebhook(req)) {
    logger.warn('Paystack webhook rejected: invalid signature');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(req.body?.toString('utf8') || '{}');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const eventType = event.event;
  const data = event.data || {};

  try {
    switch (eventType) {
      case 'charge.success': {
        const reference = data.reference;
        if (!reference) throw new Error('Missing reference in charge.success payload');

        const txns = db.prepare(
          "SELECT * FROM transactions WHERE paystack_reference = ? AND status = 'awaiting_payment'"
        ).all(reference);
        for (const txn of txns) {
          db.prepare("UPDATE transactions SET status = 'pending' WHERE id = ?").run(txn.id);
          notify(txn.buyer_id, 'payment', 'Payment Received', `Payment for "${txn.item_title}" was received and is held in escrow.`);
        }

        // Save the reusable authorization so the buyer can check out faster next time.
        const auth = data.authorization;
        if (auth?.authorization_code && auth.reusable && txns.length > 0) {
          const txn = txns[0];
          try {
            const existing = db.prepare(
              'SELECT id FROM payment_methods WHERE user_id = ? AND last4 = ? AND brand = ?'
            ).get(txn.buyer_id, auth.last4, auth.card_type);
            if (existing) {
              db.prepare('UPDATE payment_methods SET paystack_authorization_code = ? WHERE id = ?')
                .run(auth.authorization_code, existing.id);
            } else {
              db.prepare(`
                INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, exp_month, exp_year, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
              `).run(crypto.randomUUID(), txn.buyer_id, auth.authorization_code, auth.card_type, auth.card_type, auth.last4, auth.exp_month, auth.exp_year);
            }
          } catch (err) {
            logger.warn(`Could not save paystack auth code: ${err.message}`);
          }
        }

        // Subscription purchase activation (paid plan upgrade).
        const meta = data.metadata || {};
        if (meta.userId && meta.plan) {
          activatePlan(meta.userId, meta.plan);
        }

        logger.info(`Paystack charge succeeded: ${reference}`);
        break;
      }

      case 'charge.failed': {
        const reference = data.reference;
        if (reference) {
          db.prepare(`
            UPDATE transactions SET status = 'failed'
            WHERE paystack_reference = ? AND status = 'awaiting_payment'
          `).run(reference);
          logger.warn(`Paystack charge failed: ${reference}`);
        }
        break;
      }

      case 'charge.abandoned': {
        const reference = data.reference;
        if (reference) {
          db.prepare(`
            UPDATE transactions SET status = 'failed'
            WHERE paystack_reference = ? AND status = 'awaiting_payment'
          `).run(reference);
          logger.warn(`Paystack charge abandoned: ${reference}`);
        }
        break;
      }

      case 'refund.processed': {
        const reference = data.transaction?.reference || data.transaction;
        if (!reference) break;
        const txn = db.prepare('SELECT * FROM transactions WHERE paystack_reference = ?').get(reference);
        if (txn && txn.status !== 'refunded') {
          // Local bookkeeping only; the Paystack refund already happened.
          await refundTxn(txn, { skipGateway: true });
          notify(txn.buyer_id, 'system', 'Payment Refunded', `Payment for "${txn.item_title}" has been refunded.`);
          logger.info(`Paystack refund processed for ${reference}`);
        }
        break;
      }

      case 'transfer.success': {
        const transferCode = data.transfer_code || data.id;
        const recipientCode = data.recipient?.recipient_code;
        if (!transferCode) break;
        const payout = db.prepare('SELECT * FROM payouts WHERE transfer_code = ?').get(transferCode) ||
          db.prepare('SELECT * FROM payouts WHERE recipient_code = ?').get(recipientCode);
        if (payout && payout.status !== 'completed') {
          if (payout.status === 'pending' || payout.status === 'approved') {
            db.prepare("UPDATE wallets SET pending_cents = pending_cents - ? WHERE user_id = ?")
              .run(payout.amount_cents, payout.user_id);
          }
          db.prepare("UPDATE payouts SET status = 'completed', processed_at = datetime('now') WHERE id = ?").run(payout.id);
          notify(payout.user_id, 'payment', 'Payout Sent', `Your payout of ${(payout.amount_cents / 100).toFixed(2)} has been sent.`);
          logger.info(`Paystack transfer succeeded: ${transferCode}`);
        }
        break;
      }

      case 'transfer.failed':
      case 'transfer.reversed': {
        const transferCode = data.transfer_code || data.id;
        if (!transferCode) break;
        const payout = db.prepare('SELECT * FROM payouts WHERE transfer_code = ?').get(transferCode);
        if (payout && payout.status !== 'rejected' && payout.status !== 'completed') {
          db.prepare("UPDATE wallets SET available_cents = available_cents + ?, pending_cents = pending_cents - ? WHERE user_id = ?")
            .run(payout.amount_cents, payout.amount_cents, payout.user_id);
          db.prepare("UPDATE payouts SET status = 'rejected', processed_at = datetime('now'), admin_notes = 'Transfer failed at Paystack' WHERE id = ?").run(payout.id);
          notify(payout.user_id, 'payment', 'Payout Reverted', `Your payout could not be completed and has been returned to your balance.`);
          logger.warn(`Paystack transfer ${eventType}: ${transferCode}`);
        }
        break;
      }

      default:
        logger.debug(`Unhandled Paystack event type: ${eventType}`);
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Paystack webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler error' });
  }
});

// Legacy Stripe webhook endpoint. Kept as a 404-safe stub so old deploy configs
// that still send to /api/webhooks/stripe don't error; it is not processed.
router.post('/stripe', (req, res) => {
  res.status(200).json({ received: true, ignored: true });
});

export default router;