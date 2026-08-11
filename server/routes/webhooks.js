import express from 'express';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import db from '../db.js';
import { releasePromo } from './promotions.js';
import logger from '../src/logger.js';

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

  if (!webhookSecret || !stripeSecretKey) {
    logger.error('Stripe webhook rejected: STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY not configured');
    return res.status(503).json({ error: 'Stripe not configured' });
  }

  let event;
  try {
    const stripe = new Stripe(stripeSecretKey);
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error(`Stripe webhook signature verification failed: ${err.message}`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const txns = db.prepare(
          'SELECT * FROM transactions WHERE stripe_payment_intent_id = ?'
        ).all(intent.id);
        for (const txn of txns) {
          if (txn.status === 'awaiting_payment') {
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
          const txns = db.prepare(
            'SELECT * FROM transactions WHERE stripe_payment_intent_id = ?'
          ).all(intentId);
          for (const txn of txns) {
            if (txn.status === 'refunded') continue;
            if (txn.status === 'completed') {
              db.prepare('UPDATE wallets SET available_cents = MAX(0, available_cents - ?), lifetime_cents = MAX(0, lifetime_cents - ?) WHERE user_id = ?')
                .run(Math.round(txn.net_amount * 100), Math.round(txn.net_amount * 100), txn.seller_id);
            }
            if (txn.credit_cents > 0) {
              const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(txn.buyer_id);
              if (w) {
                db.prepare('UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
                  .run(txn.credit_cents, txn.buyer_id);
              }
            }
            db.prepare("UPDATE transactions SET status = 'refunded', completed_at = NULL WHERE id = ?").run(txn.id);
            db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(txn.item_id);
            if (txn.promo_code) releasePromo(txn.promo_code);
          }
        }
        logger.info(`Charge refunded: ${charge.id}`);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId;
        const plan = session.metadata?.plan;
        if (userId && plan && (plan === 'premium' || plan === 'pro')) {
          const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
          if (sub) {
            db.prepare(`
              UPDATE subscriptions SET plan = ?, status = 'active',
                current_period_start = datetime('now'),
                current_period_end = datetime('now', '+30 days'),
                trial_end = NULL,
                updated_at = datetime('now')
              WHERE user_id = ?
            `).run(plan, userId);
          }
          logger.info(`Subscription activated: user ${userId} plan ${plan}`);
        } else {
          logger.warn(`Checkout session completed without valid upgrade metadata: ${session.id}`);
        }
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
