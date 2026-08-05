import express from 'express';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import db from '../db.js';
import logger from '../src/logger.js';

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('Stripe webhook secret not configured, skipping verification');
    return res.status(200).json({ received: true });
  }

  let event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error(`Stripe webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const txn = db.prepare(
          'SELECT * FROM transactions WHERE stripe_payment_intent_id = ?'
        ).get(intent.id);
        if (txn && txn.status === 'awaiting_payment') {
          db.prepare("UPDATE transactions SET status = 'pending' WHERE id = ?").run(txn.id);
          db.prepare(`
            INSERT INTO notifications (id, user_id, type, title, body)
            VALUES (?, ?, 'payment', 'Payment Received', ?)
          `).run(
            crypto.randomUUID(),
            txn.buyer_id,
            `Payment of $${txn.amount} for "${txn.item_title}" was received and is held in escrow.`
          );
        }
        logger.info(`Payment succeeded: ${intent.id}`);
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        db.prepare(`
          UPDATE transactions SET status = 'failed'
          WHERE stripe_payment_intent_id = ?
        `).run(intent.id);
        logger.warn(`Payment failed: ${intent.id}`);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (intentId) {
          const txn = db.prepare(
            'SELECT * FROM transactions WHERE stripe_payment_intent_id = ?'
          ).get(intentId);
          if (txn) {
            db.prepare("UPDATE transactions SET status = 'refunded' WHERE stripe_payment_intent_id = ?").run(intentId);
            db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(txn.item_id);
            db.prepare("UPDATE wallets SET available_cents = MAX(0, available_cents - ?), lifetime_cents = MAX(0, lifetime_cents - ?) WHERE user_id = ?")
              .run(Math.round(txn.net_amount * 100), Math.round(txn.net_amount * 100), txn.seller_id);
          }
        }
        logger.info(`Charge refunded: ${charge.id}`);
        break;
      }

      default:
        logger.debug(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (err) {
    logger.error('Webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler error' });
  }
});

export default router;
