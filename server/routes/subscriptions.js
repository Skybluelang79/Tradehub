import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import logger from '../src/logger.js';

const router = Router();

const PLANS = {
  free: { name: 'Free', price: 0, fee: 0.03, boosts: 0, maxListings: 5, badge: null },
  premium: { name: 'Premium', price: 9.99, fee: 0.02, boosts: 2, maxListings: -1, badge: 'Premium Seller' },
  pro: { name: 'Pro', price: 24.99, fee: 0.015, boosts: 5, maxListings: -1, badge: 'Pro Seller' },
};

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_KEY && !STRIPE_KEY.includes('placeholder') ? new Stripe(STRIPE_KEY) : null;
const IS_PROD = process.env.NODE_ENV === 'production';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function getSubscription(userId) {
  let sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  if (!sub) {
    const id = uuidv4();
    db.prepare(`
      INSERT INTO subscriptions (id, user_id, plan, status, trial_end)
      VALUES (?, ?, 'free', 'active', null)
    `).run(id, userId);
    sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId);
  }
  return sub;
}

router.get('/current', authenticateToken, (req, res) => {
  try {
    const sub = getSubscription(req.user.id);
    const plan = PLANS[sub.plan] || PLANS.free;
    const isTrial = sub.status === 'trial' && sub.trial_end && new Date(sub.trial_end) > new Date();
    const planDetails = {
      ...sub,
      ...plan,
      fee: plan.fee,
      boosts: plan.boosts,
      maxListings: plan.maxListings,
      badge: plan.badge,
      isTrial,
      trialEndsAt: sub.trial_end,
      daysLeft: isTrial ? Math.ceil((new Date(sub.trial_end) - new Date()) / (1000 * 60 * 60 * 24)) : 0,
    };
    res.json({ subscription: planDetails });
  } catch (err) {
    logger.error('Get subscription error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/plans', (req, res) => {
  try {
    const plans = Object.entries(PLANS).map(([id, p]) => ({ id, ...p }));
    res.json({ plans });
  } catch (err) {
    logger.error('Get plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/upgrade', authenticateToken, async (req, res) => {
  try {
    const { plan: targetPlan } = req.body;
    if (!targetPlan || !PLANS[targetPlan]) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const sub = getSubscription(req.user.id);
    if (targetPlan === sub.plan) {
      return res.status(400).json({ error: `Already on the ${targetPlan} plan` });
    }

    // Paid plans require real payment in production. Create a Stripe Checkout
    // session; the subscription is activated by the checkout.session.completed
    // webhook. In development/demo mode the legacy free upgrade is kept so the
    // feature can still be demonstrated without Stripe.
    const isPaid = PLANS[targetPlan].price > 0;
    if (isPaid && IS_PROD) {
      if (!stripe) {
        return res.status(503).json({ error: 'Paid subscriptions require Stripe to be configured' });
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{
          price_data: {
            currency: 'usd',
            product_data: { name: `${PLANS[targetPlan].name} Seller Plan` },
            recurring: { interval: 'month' },
            unit_amount: Math.round(PLANS[targetPlan].price * 100),
          },
          quantity: 1,
        }],
        metadata: { userId: req.user.id, plan: targetPlan },
        client_reference_id: req.user.id,
        success_url: `${APP_URL}/profile?upgrade=success&plan=${targetPlan}`,
        cancel_url: `${APP_URL}/profile?upgrade=cancelled`,
        allow_promotion_codes: false,
      });
      return res.json({ requires_payment: true, checkoutUrl: session.url });
    }

    db.prepare(`
      UPDATE subscriptions SET plan = ?, status = 'active',
        current_period_start = datetime('now'),
        current_period_end = datetime('now', '+30 days'),
        trial_end = NULL,
        updated_at = datetime('now')
      WHERE user_id = ?
    `).run(targetPlan, req.user.id);

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'system', 'Plan Upgraded', ?)
    `).run(uuidv4(), req.user.id, `You're now on the ${PLANS[targetPlan].name} plan!`);

    const updated = getSubscription(req.user.id);
    const plan = PLANS[updated.plan];
    res.json({
      success: true,
      subscription: { ...updated, ...plan },
    });
  } catch (err) {
    logger.error('Upgrade error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cancel', authenticateToken, (req, res) => {
  try {
    const sub = getSubscription(req.user.id);
    if (sub.plan === 'free') {
      return res.status(400).json({ error: 'Already on free plan' });
    }

    db.prepare(`
      UPDATE subscriptions SET plan = 'free', status = 'cancelled',
        cancelled_at = datetime('now'), updated_at = datetime('now')
      WHERE user_id = ?
    `).run(req.user.id);

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'system', 'Plan Downgraded', ?)
    `).run(uuidv4(), req.user.id, 'Your plan has been downgraded to Free.');

    res.json({ success: true, plan: 'free' });
  } catch (err) {
    logger.error('Cancel subscription error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/benefits', authenticateToken, (req, res) => {
  try {
    const sub = getSubscription(req.user.id);

    const isTrial = sub.status === 'trial' && sub.trial_end && new Date(sub.trial_end) > new Date();
    const effectivePlan = isTrial ? 'premium' : sub.plan;
    const effective = PLANS[effectivePlan] || PLANS.free;

    const benefits = [
      { icon: '📦', title: 'Max Listings', desc: effective.maxListings === -1 ? 'Unlimited listings' : `${effective.maxListings} listings` },
      { icon: '💰', title: 'Transaction Fee', desc: `${(effective.fee * 100).toFixed(1)}% per sale` },
      { icon: '🚀', title: 'Free Boosts', desc: `${effective.boosts} boosts per month` },
      { icon: '⭐', title: 'Premium Badge', desc: effective.badge ? `Show "${effective.badge}" badge` : 'No badge' },
      { icon: '📊', title: 'Analytics', desc: effectivePlan !== 'free' ? 'Full analytics dashboard' : 'Basic analytics' },
      { icon: '💬', title: 'Support', desc: effectivePlan === 'pro' ? 'Priority support' : effectivePlan === 'premium' ? 'Email support' : 'Standard support' },
    ];

    res.json({ benefits, plan: effectivePlan, ...effective });
  } catch (err) {
    logger.error('Get benefits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
