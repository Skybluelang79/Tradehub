import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  paystack,
  isPaystackConfigured,
  PAYSTACK_PUBLIC_KEY,
  DEFAULT_CURRENCY,
  toMinorUnits,
} from '../src/paystack.js';
import logger from '../src/logger.js';

const router = Router();

const PLANS = {
  free: { name: 'Free', price: 0, fee: 0.03, boosts: 0, maxListings: 5, badge: null },
  premium: { name: 'Premium', price: 9.99, fee: 0.02, boosts: 2, maxListings: -1, badge: 'Premium Seller' },
  pro: { name: 'Pro', price: 24.99, fee: 0.015, boosts: 5, maxListings: -1, badge: 'Pro Seller' },
};

const IS_PROD = process.env.NODE_ENV === 'production';

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

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

// Idempotent plan activation used by both the verify route and the
// `charge.success` webhook after a successful Paystack payment.
export function activatePlan(userId, plan) {
  if (!PLANS[plan]) return false;
  const sub = getSubscription(userId);
  db.prepare(`
    UPDATE subscriptions SET plan = ?, status = 'active',
      current_period_start = datetime('now'),
      current_period_end = datetime('now', '+30 days'),
      trial_end = NULL,
      pending_plan = NULL,
      paystack_reference = NULL,
      updated_at = datetime('now')
    WHERE user_id = ?
  `).run(plan, userId);
  if (!sub || sub.plan !== plan) {
    notify(userId, 'system', 'Plan Upgraded', `You're now on the ${PLANS[plan].name} plan!`);
  }
  return true;
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

    // Paid plans require payment. In production we charge through Paystack and
    // activate the plan after the charge succeeds (webhook or verify call). In
    // development/demo mode a free upgrade is kept so the feature can still be
    // demonstrated without a configured gateway.
    const isPaid = PLANS[targetPlan].price > 0;
    if (isPaid && IS_PROD) {
      if (!isPaystackConfigured()) {
        return res.status(503).json({ error: 'Paid subscriptions require Paystack to be configured' });
      }
      const reference = uuidv4();
      const amountMinor = toMinorUnits(PLANS[targetPlan].price, DEFAULT_CURRENCY);
      const initialized = await paystack.initializeTransaction({
        amountMinor,
        currency: DEFAULT_CURRENCY,
        email: req.user.email,
        reference,
        metadata: { userId: req.user.id, plan: targetPlan, tradehub_subscription: reference },
        callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
      });

      // Remember which plan this reference is paying for so the frontend/webhook
      // can activate it idempotently.
      db.prepare("UPDATE subscriptions SET pending_plan = ?, paystack_reference = ?, updated_at = datetime('now') WHERE user_id = ?")
        .run(targetPlan, reference, req.user.id);

      return res.json({
        requires_payment: true,
        reference,
        accessCode: initialized.access_code,
        authorizationUrl: initialized.authorization_url,
        publicKey: PAYSTACK_PUBLIC_KEY,
        currency: DEFAULT_CURRENCY,
      });
    }

    activatePlan(req.user.id, targetPlan);

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

// Verifies a Paystack subscription payment after the Paystack Pop callback.
// Idempotent: the plan is only activated once per reference.
router.get('/upgrade/verify/:reference', authenticateToken, async (req, res) => {
  try {
    const ref = req.params.reference;
    const sub = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(req.user.id);
    if (!sub || sub.paystack_reference !== ref) {
      return res.status(404).json({ error: 'Reference not found' });
    }
    if (sub.plan === sub.pending_plan && sub.status === 'active') {
      return res.json({ success: true, alreadyProcessed: true, plan: sub.plan });
    }

    if (!isPaystackConfigured()) {
      return res.status(503).json({ error: 'Paystack is not configured' });
    }

    const verified = await paystack.verifyTransaction(ref);
    if (verified.status !== 'success') {
      return res.status(400).json({ error: `Payment not successful (${verified.status})` });
    }

    const plan = sub.pending_plan || verified.metadata?.plan;
    if (!plan || !PLANS[plan]) {
      return res.status(400).json({ error: 'No plan associated with this payment' });
    }

    activatePlan(req.user.id, plan);
    const updated = getSubscription(req.user.id);
    res.json({ success: true, plan: updated.plan, subscription: { ...updated, ...PLANS[updated.plan] } });
  } catch (err) {
    if (err.status === 400 || err.status === 404) return res.status(err.status).json({ error: err.message });
    logger.error('Verify upgrade error:', err);
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

    notify(req.user.id, 'system', 'Plan Downgraded', 'Your plan has been downgraded to Free.');

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