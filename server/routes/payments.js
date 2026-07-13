import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

router.get('/methods', authenticateToken, (req, res) => {
  try {
    const methods = db.prepare(
      'SELECT id, brand, last4, exp_month, exp_year, is_default, created_at FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC'
    ).all(req.user.id);
    res.json({ methods });
  } catch (err) {
    console.error('Get payment methods error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/methods', authenticateToken, (req, res) => {
  try {
    const { brand, last4, exp_month, exp_year, is_default, stripe_payment_method_id } = req.body;

    if (!brand || !last4 || !exp_month || !exp_year) {
      return res.status(400).json({ error: 'Card details required' });
    }

    if (is_default) {
      db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO payment_methods (id, user_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, stripe_payment_method_id || null, brand, last4, exp_month, exp_year, is_default ? 1 : 0);

    const method = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
    res.status(201).json({ method });
  } catch (err) {
    console.error('Add payment method error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/methods/:id/default', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    db.prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Set default error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/methods/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM payment_methods WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Remove payment method error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { itemId, paymentMethodId } = req.body;
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);

    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id === req.user.id) return res.status(400).json({ error: 'Cannot buy your own item' });

    const amount = item.sale_price || item.price;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      metadata: { itemId, buyerId: req.user.id, sellerId: item.seller_id },
      automatic_payment_methods: { enabled: true },
    });

    const txnId = uuidv4();
    db.prepare(`
      INSERT INTO transactions (id, item_id, item_title, item_image, amount, buyer_id, seller_id, payment_method_id, stripe_payment_intent_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      txnId, itemId, item.title,
      db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(itemId)?.url || '',
      amount, req.user.id, item.seller_id,
      paymentMethodId || null, paymentIntent.id
    );

    res.json({ clientSecret: paymentIntent.client_secret, transactionId: txnId });
  } catch (err) {
    console.error('Create intent error:', err);
    if (err.message?.includes('stripe')) {
      res.json({ clientSecret: 'demo_secret', transactionId: uuidv4(), demo: true });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

router.post('/confirm/:txnId', authenticateToken, (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });

    db.prepare("UPDATE transactions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(req.params.txnId);
    db.prepare("UPDATE items SET status = 'sold' WHERE id = ?").run(txn.item_id);

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'sale', 'Payment Confirmed', ?)
    `).run(uuidv4(), txn.buyer_id, `Payment of $${txn.amount} for "${txn.item_title}" confirmed.`);
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'sale', 'Item Sold', ?)
    `).run(uuidv4(), txn.seller_id, `"${txn.item_title}" has been sold for $${txn.amount}!`);

    res.json({ success: true });
  } catch (err) {
    console.error('Confirm payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/transactions', authenticateToken, (req, res) => {
  try {
    const { filter = 'all' } = req.query;
    let query = 'SELECT * FROM transactions WHERE';
    const params = [];

    if (filter === 'received') {
      query += ' seller_id = ?';
      params.push(req.user.id);
    } else if (filter === 'sent') {
      query += ' buyer_id = ?';
      params.push(req.user.id);
    } else {
      query += ' (buyer_id = ? OR seller_id = ?)';
      params.push(req.user.id, req.user.id);
    }

    query += ' ORDER BY created_at DESC';
    const transactions = db.prepare(query).all(...params);
    res.json({ transactions });
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refund/:txnId', authenticateToken, (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.seller_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    db.prepare("UPDATE transactions SET status = 'refunded' WHERE id = ?").run(req.params.txnId);
    db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(txn.item_id);

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'system', 'Payment Refunded', ?)
    `).run(uuidv4(), txn.buyer_id, `Payment for "${txn.item_title}" has been refunded.`);

    res.json({ success: true });
  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
