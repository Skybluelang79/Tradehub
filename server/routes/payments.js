import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { validateAndApplyPromo, consumePromo, releasePromo } from './promotions.js';
import { sendNotificationEmail } from '../src/email.js';
import logger from '../src/logger.js';
import {
  paystack,
  isPaystackConfigured,
  PAYSTACK_PUBLIC_KEY,
  toMinorUnits,
  toMajorUnits,
  DEFAULT_CURRENCY,
  isValidCurrency,
} from '../src/paystack.js';

const router = Router();

// ============================================================================
// Escrow model
// ----------------------------------------------------------------------------
// Buyers pay through Paystack (card / bank transfer / dedicated account). The
// platform's Paystack balance acts as the escrow vault: a successful charge
// moves the transaction to `pending`, where funds are "held". When the buyer
// confirms delivery (or the auto-release window elapses) the transaction is
// finalized and the seller's wallet is credited. Sellers then withdraw via the
// Paystack Transfers API (`payouts.js`).
// ============================================================================

// "Demo mode" transactions (Paystack not configured) mint fake money and are
// only allowed in non-production runs, or when explicitly opted in. A
// misconfigured production deployment will refuse card payments instead of
// crediting sellers.
const ALLOW_DEMO_PAYMENTS = process.env.DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';

const PLAN_FEES = { free: 0.03, premium: 0.02, pro: 0.015 };

// Fees, refunds and subscription commissions share this public helper so the
// admin Paystack settings page can render the same numbers as the checkout.
export function getFeeRateForSeller(sellerId) {
  try {
    const sub = db.prepare("SELECT plan FROM subscriptions WHERE user_id = ? AND status != 'cancelled'").get(sellerId);
    if (sub && PLAN_FEES[sub.plan] != null) return PLAN_FEES[sub.plan];
  } catch {}
  const adminFee = platformFeePercent();
  if (Number.isFinite(adminFee) && adminFee >= 0) return adminFee / 100;
  return 0.03;
}

function platformFeePercent() {
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'").get();
    const v = parseFloat(row?.value);
    if (Number.isFinite(v) && v >= 0) return v;
  } catch {}
  return 3;
}

function notify(userId, type, title, body, data = {}) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body, JSON.stringify(data));
}

// ---- Store credit / gift card helpers --------------------------------------

function getWallet(userId) {
  let w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (!w) {
    db.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(userId);
    w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  }
  return w;
}

function insertTransaction({ txnId, item, amount, currency, buyerId, sellerId, method, status, paystackRef, paymentMethodId, promoCode, discountAmount, originalAmount, creditCents = 0 }) {
  const image = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(item.id)?.url || '';
  db.prepare(`
    INSERT INTO transactions (id, item_id, item_title, item_image, amount, currency, buyer_id, seller_id, payment_method_id, paystack_reference, method, provider_ref, status, promo_code, discount_amount, original_amount, credit_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txnId, item.id, item.title, image, amount, currency, buyerId, sellerId,
    paymentMethodId || null, paystackRef || null,
    method, paystackRef || '', status,
    promoCode || '', discountAmount || 0, originalAmount || amount,
    creditCents || 0
  );
}

// ---- Credit helpers ---------------------------------------------------------

function getGiftCard(code) {
  const card = db.prepare('SELECT * FROM gift_cards WHERE UPPER(code) = ?').get(String(code || '').trim().toUpperCase());
  if (!card) { const err = new Error('Invalid gift card code'); err.status = 400; throw err; }
  if (card.status === 'redeemed') { const err = new Error('Gift card already redeemed'); err.status = 400; throw err; }
  if (card.status === 'voided') { const err = new Error('Gift card has been voided'); err.status = 400; throw err; }
  if (card.balance_cents <= 0) { const err = new Error('Gift card has no balance'); err.status = 400; throw err; }
  if (card.expires_at && new Date(card.expires_at) < new Date()) { const err = new Error('Gift card has expired'); err.status = 400; throw err; }
  return card;
}

function calculateCredit(userId, giftCardCode, amountCents) {
  const wallet = getWallet(userId);
  let availableCents = wallet.credit_cents;
  let giftCard = null;
  if (giftCardCode) {
    giftCard = getGiftCard(giftCardCode);
    availableCents += giftCard.balance_cents;
  }
  const creditCents = Math.min(availableCents, amountCents);
  return { creditCents, giftCard };
}

function applyCredit({ userId, giftCard, creditCents }) {
  if (creditCents <= 0) return;
  let remaining = creditCents;
  if (giftCard) {
    const cardUse = Math.min(giftCard.balance_cents, remaining);
    remaining -= cardUse;
    const newBalance = giftCard.balance_cents - cardUse;
    if (newBalance <= 0) {
      db.prepare("UPDATE gift_cards SET status = 'redeemed', balance_cents = 0, redeemed_by = ?, redeemed_at = datetime('now') WHERE id = ?")
        .run(userId, giftCard.id);
    } else {
      db.prepare('UPDATE gift_cards SET balance_cents = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newBalance, giftCard.id);
    }
  }
  if (remaining > 0) {
    getWallet(userId);
    db.prepare('UPDATE wallets SET credit_cents = credit_cents - ?, updated_at = datetime(\'now\') WHERE user_id = ?')
      .run(remaining, userId);
  }
}

function restoreCredit(userId, creditCents) {
  if (!creditCents || creditCents <= 0) return;
  getWallet(userId);
  db.prepare('UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(creditCents, userId);
}

// ---- Saved payment methods --------------------------------------------------
// Cards become "saved" by storing the Paystack authorization code returned on
// a successful charge, so repeat purchases can use charge_authorization.

router.get('/methods', authenticateToken, (req, res) => {
  try {
    const methods = db.prepare(
      'SELECT id, brand, card_type, last4, exp_month, exp_year, is_default, created_at FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC'
    ).all(req.user.id);
    res.json({ methods });
  } catch (err) {
    logger.error('Get payment methods error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/methods', authenticateToken, (req, res) => {
  try {
    const { brand, last4, exp_month, exp_year, card_type = '', is_default, authorizationCode } = req.body;
    if ((!brand || !last4) && !authorizationCode) {
      return res.status(400).json({ error: 'Card details required' });
    }
    if (is_default) {
      db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }
    const id = uuidv4();
    db.prepare(`
      INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, exp_month, exp_year, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, authorizationCode || null, brand, card_type, last4, exp_month || null, exp_year || null, is_default ? 1 : 0);
    const method = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
    res.status(201).json({ method });
  } catch (err) {
    logger.error('Add payment method error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/methods/:id/default', authenticateToken, (req, res) => {
  try {
    db.prepare('UPDATE payment_methods SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    db.prepare('UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Set default error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/methods/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM payment_methods WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Remove payment method error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Wallet ----------------------------------------------------------------

router.get('/wallet', authenticateToken, (req, res) => {
  try {
    res.json({ wallet: getWallet(req.user.id) });
  } catch (err) {
    logger.error('Get wallet error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Payment options presented at checkout. The card option is backed by Paystack
// (popup) whenever it is configured; bank uses Paystack's dedicated bank
// account channels.
router.get('/options', authenticateToken, (req, res) => {
  try {
    const wallet = getWallet(req.user.id);
    const configured = isPaystackConfigured();
    res.json({
      feePercent: platformFeePercent(),
      publicKey: PAYSTACK_PUBLIC_KEY,
      live: configured,
      currency: DEFAULT_CURRENCY,
      methods: [
        {
          id: 'card',
          name: configured ? 'Paystack Card' : 'Card',
          enabled: true,
          description: 'Pay instantly with any debit or credit card (Visa, Mastercard, Verve) inside TradeHub.',
          live: configured,
        },
        {
          id: 'paystack_bank',
          name: 'Paystack Bank Transfer',
          enabled: configured && process.env.PAYSTACK_BANK_TRANSFER_ENABLED !== 'false',
          description: 'Pay via a dedicated Paystack bank account generated for this order. Funds are auto-confirmed.',
          live: configured,
        },
        {
          id: 'gift_card',
          name: 'Gift Card / Store Credit',
          enabled: true,
          description: 'Use gift card credit or your store credit balance at checkout.',
          creditCents: wallet.credit_cents,
        },
      ],
    });
  } catch (err) {
    logger.error('Get payment options error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Checkout (single item) -------------------------------------------------

// Builds the common parts of a checkout: item validation, promo discount and
// store-credit allocation. Returns the items passed validation plus totals.
function buildCheckout(req) {
  const { itemId, offerId, giftCardCode, promoCode, useCredit, currency } = req.body;
  const offer = offerId ? db.prepare('SELECT * FROM offers WHERE id = ?').get(offerId) : null;
  const actualItemId = offer ? offer.item_id : itemId;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(actualItemId);
  if (!item) { const err = new Error('Item not found'); err.status = 404; throw err; }
  if (item.seller_id === req.user.id) { const err = new Error('Cannot buy your own item'); err.status = 400; throw err; }
  if (offer) {
    if (offer.buyer_id !== req.user.id) { const err = new Error('Not authorized to purchase with this offer'); err.status = 403; throw err; }
    if (offer.status !== 'accepted') { const err = new Error('Offer has not been accepted yet'); err.status = 400; throw err; }
    if (offer.item_id !== item.id) { const err = new Error('Offer does not match this item'); err.status = 400; throw err; }
  } else {
    if (item.status === 'sold') { const err = new Error('Item is already sold'); err.status = 400; throw err; }
  }

  const curr = currency || offer?.currency || DEFAULT_CURRENCY;
  if (!isValidCurrency(curr)) { const err = new Error('Unsupported currency'); err.status = 400; throw err; }

  const baseAmount = offer ? (offer.amount_cents / 100) : (item.sale_price || item.price);
  let promoDiscount = 0;
  let promoCodeUsed = null;
  if (promoCode) {
    const applied = validateAndApplyPromo(promoCode, baseAmount);
    promoDiscount = applied.discount;
    promoCodeUsed = String(promoCode).trim().toUpperCase();
  }
  const amount = Math.round((baseAmount - promoDiscount) * 100) / 100;
  const amountCents = Math.round(amount * 100);
  const promoInfo = promoCodeUsed ? { code: promoCodeUsed, discount: promoDiscount } : null;

  const wantsCredit = req.body.method === 'credit' || req.body.method === 'gift_card' || !!giftCardCode || useCredit === true;
  let creditCents = 0;
  let giftCard = null;
  if (wantsCredit) {
    const calc = calculateCredit(req.user.id, giftCardCode, amountCents);
    creditCents = calc.creditCents;
    giftCard = calc.giftCard;
  }
  if (req.body.method === 'credit' || req.body.method === 'gift_card') {
    if (creditCents < amountCents) {
      const err = new Error('Insufficient store credit');
      err.status = 402;
      err.details = { creditCents, amountCents };
      throw err;
    }
  }
  const chargeCents = amountCents - creditCents;
  return { item, amount, amountCents, currency: curr, promoDiscount, promoCodeUsed, promoInfo, creditCents, giftCard, chargeCents, offerId: offer?.id || null };
}

router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { item, amount, amountCents, currency, promoDiscount, promoCodeUsed, promoInfo, creditCents, giftCard, chargeCents } = buildCheckout(req);
    const method = req.body.method === 'bank' || req.body.method === 'paystack_bank' ? 'bank' : (req.body.method || 'card');
    const txnId = uuidv4();

    // Fully covered by store credit / gift card — nothing to charge.
    if (chargeCents === 0) {
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      insertTransaction({ txnId, item, amount, currency, buyerId: req.user.id, sellerId: item.seller_id, method: 'credit', status: 'pending', paymentMethodId: null, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: item.sale_price || item.price, creditCents });
      return res.json({ transactionId: txnId, status: 'pending', method: 'credit', paid: true, amountCents, creditCents, promo: promoInfo, currency });
    }

    // Card / bank via Paystack.
    if (!isPaystackConfigured()) {
      if (!ALLOW_DEMO_PAYMENTS) {
        return res.status(503).json({ error: 'Payments are not configured. Set PAYSTACK_SECRET_KEY or enable DEMO_MODE.' });
      }
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      insertTransaction({ txnId, item, amount, currency, buyerId: req.user.id, sellerId: item.seller_id, method: method === 'bank' ? 'bank' : 'card', status: 'pending', paystackRef: `demo_${txnId}`, paymentMethodId: null, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: item.sale_price || item.price, creditCents });
      return res.json({ demo: true, transactionId: txnId, status: 'pending', paid: true, amountCents, creditCents, promo: promoInfo, currency });
    }

    const channels = method === 'bank' ? ['bank_transfer', 'card'] : ['card'];
    const initialized = await paystack.initializeTransaction({
      amountMinor: toMinorUnits(chargeCents / 100, currency),
      currency,
      email: req.user.email,
      reference: txnId,
      channels,
      metadata: { itemId: item.id, buyerId: req.user.id, sellerId: item.seller_id, tradehub_transaction: txnId },
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
    });

    // Reserve the buyer's credit now; it is restored if the payment is abandoned.
    applyCredit({ userId: req.user.id, giftCard, creditCents });
    insertTransaction({ txnId, item, amount, currency, buyerId: req.user.id, sellerId: item.seller_id, method: method === 'bank' ? 'bank' : 'card', status: 'awaiting_payment', paystackRef: txnId, paymentMethodId: null, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: item.sale_price || item.price, creditCents });

    res.json({
      transactionId: txnId,
      reference: txnId,
      accessCode: initialized.access_code,
      authorizationUrl: initialized.authorization_url,
      publicKey: PAYSTACK_PUBLIC_KEY,
      status: 'awaiting_payment',
      amountCents,
      chargeCents,
      creditCents,
      currency,
      promo: promoInfo,
    });
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 402) return res.status(err.status).json({ error: err.message, ...(err.details || {}) });
    logger.error('Create intent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Cart -------------------------------------------------------------------

function getCart(userId) {
  return db.prepare(`
    SELECT c.item_id, c.quantity, c.created_at,
      i.title, i.price, i.sale_price, i.category, i.condition, i.status,
      i.seller_id, i.quantity AS stock,
      (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) AS image,
      u.name AS seller_name, u.avatar AS seller_avatar
    FROM carts c
    JOIN items i ON i.id = c.item_id
    LEFT JOIN users u ON u.id = i.seller_id
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
  `).all(userId);
}

function cartSubtotal(items) {
  return items.reduce((sum, it) => sum + Math.round((it.sale_price || it.price) * it.quantity * 100), 0);
}

function insertCartLine(line, index, txnIds, { method, status, paystackRef, paymentMethodId, promoCodeUsed, currency, buyerId }) {
  insertTransaction({
    txnId: txnIds[index],
    item: line.item,
    amount: line.lineNetCents / 100,
    currency,
    buyerId,
    sellerId: line.item.seller_id,
    method,
    status,
    paystackRef,
    paymentMethodId,
    promoCode: promoCodeUsed,
    discountAmount: line.lineDiscountCents / 100,
    originalAmount: line.baseAmount,
    creditCents: line.lineCreditCents,
  });
}

router.get('/cart', authenticateToken, (req, res) => {
  try {
    const items = getCart(req.user.id);
    res.json({ items, count: items.length, subtotalCents: cartSubtotal(items) });
  } catch (err) {
    logger.error('Get cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cart', authenticateToken, (req, res) => {
  try {
    const { itemId, quantity = 1 } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    if (!itemId) return res.status(400).json({ error: 'Item required' });

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id === req.user.id) return res.status(400).json({ error: 'Cannot add your own item to cart' });
    if (item.status === 'sold') return res.status(400).json({ error: 'Item is already sold' });
    if (item.quantity != null && item.quantity > 0 && qty > item.quantity) {
      return res.status(400).json({ error: `Only ${item.quantity} available` });
    }

    db.prepare(`
      INSERT INTO carts (user_id, item_id, quantity) VALUES (?, ?, ?)
      ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')
    `).run(req.user.id, itemId, qty);

    const cart = getCart(req.user.id);
    res.status(201).json({ items: cart, count: cart.length, subtotalCents: cartSubtotal(cart) });
  } catch (err) {
    if (err.status === 400 || err.status === 404) return res.status(err.status).json({ error: err.message });
    logger.error('Add to cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/cart/:itemId', authenticateToken, (req, res) => {
  try {
    const { quantity } = req.body;
    const qty = Math.max(1, parseInt(quantity, 10) || 1);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.itemId);
    if (item && item.quantity != null && item.quantity > 0 && qty > item.quantity) {
      return res.status(400).json({ error: `Only ${item.quantity} available` });
    }
    db.prepare("UPDATE carts SET quantity = ?, updated_at = datetime('now') WHERE user_id = ? AND item_id = ?")
      .run(qty, req.user.id, req.params.itemId);
    const cart = getCart(req.user.id);
    res.json({ items: cart, count: cart.length, subtotalCents: cartSubtotal(cart) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error('Update cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/cart/:itemId', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM carts WHERE user_id = ? AND item_id = ?').run(req.user.id, req.params.itemId);
    const cart = getCart(req.user.id);
    res.json({ items: cart, count: cart.length, subtotalCents: cartSubtotal(cart) });
  } catch (err) {
    logger.error('Remove cart item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/cart', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
    res.json({ success: true, items: [], count: 0, subtotalCents: 0 });
  } catch (err) {
    logger.error('Clear cart error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/cart/checkout', authenticateToken, async (req, res) => {
  try {
    const { method: rawMethod = 'card', giftCardCode, promoCode, currency: reqCurrency } = req.body;
    const currency = isValidCurrency(reqCurrency) ? reqCurrency : DEFAULT_CURRENCY;
    const method = rawMethod === 'bank' || rawMethod === 'paystack_bank' ? 'bank' : 'card';
    const cartItems = getCart(req.user.id);
    if (!cartItems.length) return res.status(400).json({ error: 'Your cart is empty' });

    const lines = [];
    for (const line of cartItems) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(line.item_id);
      if (!item) { const e = new Error('Item no longer exists'); e.status = 400; throw e; }
      if (item.seller_id === req.user.id) { const e = new Error('Cannot buy your own item'); e.status = 400; throw e; }
      if (item.status === 'sold') { const e = new Error(`"${item.title}" is already sold`); e.status = 400; throw e; }
      if (item.quantity != null && item.quantity > 0 && line.quantity > item.quantity) {
        const e = new Error(`Only ${item.quantity} of "${item.title}" available`); e.status = 400; throw e;
      }
      const baseAmount = (item.sale_price || item.price) * line.quantity;
      lines.push({ item, quantity: line.quantity, baseAmount });
    }

    const subtotalCents = Math.round(lines.reduce((s, l) => s + l.baseAmount, 0) * 100);
    const subtotal = subtotalCents / 100;

    let promoDiscount = 0;
    let promoCodeUsed = null;
    if (promoCode) {
      const applied = validateAndApplyPromo(promoCode, subtotal);
      promoDiscount = applied.discount;
      promoCodeUsed = String(promoCode).trim().toUpperCase();
    }
    const promoInfo = promoCodeUsed ? { code: promoCodeUsed, discount: promoDiscount } : null;

    const allocated = lines.map((l) => {
      const lineSubtotalCents = Math.round(l.baseAmount * 100);
      let lineDiscountCents = 0;
      if (promoDiscount > 0) {
        lineDiscountCents = Math.round((lineSubtotalCents / subtotalCents) * Math.round(promoDiscount * 100));
      }
      const lineNetCents = lineSubtotalCents - lineDiscountCents;
      return { ...l, lineSubtotalCents, lineDiscountCents, lineNetCents };
    });

    let totalCents = allocated.reduce((s, l) => s + l.lineNetCents, 0);
    if (promoDiscount > 0) {
      const expected = Math.round((subtotal - promoDiscount) * 100);
      const drift = expected - totalCents;
      if (drift !== 0) {
        allocated[allocated.length - 1].lineNetCents += drift;
        allocated[allocated.length - 1].lineDiscountCents -= drift;
        totalCents = expected;
      }
    }

    const calc = calculateCredit(req.user.id, giftCardCode, totalCents);
    const creditCents = calc.creditCents;
    const giftCard = calc.giftCard;
    let remainingCredit = creditCents;
    for (const l of allocated) {
      const use = Math.min(remainingCredit, l.lineNetCents);
      l.lineCreditCents = use;
      remainingCredit -= use;
    }
    const chargeCents = totalCents - creditCents;

    const txnIds = allocated.map(() => uuidv4());
    const paystackRef = chargeCents > 0 ? uuidv4() : null;

    // Fully covered by credit / gift card.
    if (chargeCents === 0) {
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      allocated.forEach((l, i) => insertCartLine(l, i, txnIds, { method: 'credit', status: 'pending', paystackRef: null, paymentMethodId: null, promoCodeUsed, currency, buyerId: req.user.id }));
      db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
      return res.json({ paid: true, status: 'pending', method: 'credit', transactionIds: txnIds, totalCents, creditCents, count: allocated.length, promo: promoInfo, currency });
    }

    // Demo mode (no Paystack configured).
    if (!isPaystackConfigured()) {
      if (!ALLOW_DEMO_PAYMENTS) {
        return res.status(503).json({ error: 'Payments are not configured. Set PAYSTACK_SECRET_KEY or enable DEMO_MODE.' });
      }
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      allocated.forEach((l, i) => insertCartLine(l, i, txnIds, { method: method === 'bank' ? 'bank' : 'card', status: 'pending', paystackRef: `demo_${txnIds[i]}`, paymentMethodId: null, promoCodeUsed, currency, buyerId: req.user.id }));
      db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
      return res.json({ demo: true, paid: true, status: 'pending', transactionIds: txnIds, totalCents, creditCents, count: allocated.length, promo: promoInfo, currency });
    }

    // Charge the buyer through Paystack.
    const channels = method === 'bank' ? ['bank_transfer', 'card'] : ['card'];
    const initialized = await paystack.initializeTransaction({
      amountMinor: toMinorUnits(chargeCents / 100, currency),
      currency,
      email: req.user.email,
      reference: paystackRef,
      channels,
      metadata: { itemIds: allocated.map((l) => l.item.id), buyerId: req.user.id, tradehub_transaction: paystackRef },
      callbackUrl: process.env.PAYSTACK_CALLBACK_URL,
    });
    applyCredit({ userId: req.user.id, giftCard, creditCents });
    allocated.forEach((l, i) => insertCartLine(l, i, txnIds, { method: method === 'bank' ? 'bank' : 'card', status: 'awaiting_payment', paystackRef, paymentMethodId: null, promoCodeUsed, currency, buyerId: req.user.id }));
    db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);

    res.json({
      transactionIds: txnIds,
      reference: paystackRef,
      accessCode: initialized.access_code,
      authorizationUrl: initialized.authorization_url,
      publicKey: PAYSTACK_PUBLIC_KEY,
      status: 'awaiting_payment',
      totalCents,
      chargeCents,
      creditCents,
      count: allocated.length,
      promo: promoInfo,
      currency,
    });
  } catch (err) {
    if (err.status === 400 || err.status === 404 || err.status === 402) return res.status(err.status).json({ error: err.message });
    logger.error('Cart checkout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Verification -----------------------------------------------------------
// Called by the frontend after a successful Paystack Pop charge, and used as a
// fallback if a webhook is delivered after the page. Idempotent.

router.post('/verify/:reference', authenticateToken, async (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE paystack_reference = ?').get(req.params.reference);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.buyer_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'Not authorized' });
    if (txn.status === 'pending' || txn.status === 'completed') {
      return res.json({ status: txn.status, alreadyProcessed: true, success: true, transactionId: txn.id });
    }
    if (txn.status !== 'awaiting_payment') {
      return res.status(400).json({ error: `Transaction is not awaiting payment (${txn.status})` });
    }
    if (!isPaystackConfigured() && txn.paystack_reference?.startsWith('demo_')) {
      // Demo transactions are already paid; verify locally without Paystack.
      db.prepare("UPDATE transactions SET status = 'pending' WHERE id = ?").run(txn.id);
      notify(txn.buyer_id, 'payment', 'Payment Received', `Demo payment for "${txn.item_title}" is held in escrow.`);
      return res.json({ status: 'pending', success: true, transactionId: txn.id, demo: true });
    }

    const verified = await paystack.verifyTransaction(txn.paystack_reference);
    const status = verified.status;
    if (status !== 'success') {
      return res.status(400).json({ error: `Payment not successful (${status})` });
    }

    db.prepare("UPDATE transactions SET status = 'pending' WHERE id = ?").run(txn.id);
    // Save the reusable authorization code so buyers can check out faster next time.
    const auth = verified.authorization;
    if (auth?.authorization_code && auth.reusable) {
      saveAuthorization(req.user.id, auth);
    }
    notify(txn.buyer_id, 'payment', 'Payment Received', `Payment of ${txn.amount} ${txn.currency} for "${txn.item_title}" is held in escrow.`);
    res.json({ status: 'pending', success: true, transactionId: txn.id, currency: txn.currency, amount: txn.amount });
  } catch (err) {
    if (err.status === 400 || err.status === 403 || err.status === 404) return res.status(err.status).json({ error: err.message });
    logger.error('Verify payment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function saveAuthorization(userId, auth) {
  try {
    const existing = db.prepare(
      'SELECT id FROM payment_methods WHERE user_id = ? AND last4 = ? AND brand = ?'
    ).get(userId, auth.last4, auth.card_type);
    if (existing) {
      db.prepare('UPDATE payment_methods SET paystack_authorization_code = ? WHERE id = ?')
        .run(auth.authorization_code, existing.id);
      return existing.id;
    }
    const id = uuidv4();
    db.prepare(`
      INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, exp_month, exp_year, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, userId, auth.authorization_code, auth.card_type, auth.card_type, auth.last4, auth.exp_month, auth.exp_year);
    return id;
  } catch (err) {
    logger.warn('Could not save payment method:', err.message);
    return null;
  }
}

// ---- Transaction lifecycle --------------------------------------------------

export async function expireAwaitingPayment(txn) {
  if (!txn || txn.status !== 'awaiting_payment') return false;
  restoreCredit(txn.buyer_id, txn.credit_cents || 0);
  db.prepare("UPDATE transactions SET status = 'expired', completed_at = NULL WHERE id = ?").run(txn.id);
  notify(txn.buyer_id, 'payment', 'Payment Expired', `Your pending payment for "${txn.item_title}" expired and was cancelled. Any store credit used has been returned.`);
  return true;
}

export function finalizeCompleted(txn) {
  if (!txn || txn.status === 'completed') return false;
  db.prepare("UPDATE transactions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(txn.id);
  db.prepare("UPDATE items SET status = 'sold' WHERE id = ?").run(txn.item_id);

  const amountCents = Math.round(txn.amount * 100);
  const feeCents = Math.round(amountCents * getFeeRateForSeller(txn.seller_id));
  const netCents = amountCents - feeCents;
  db.prepare('UPDATE transactions SET fee_amount = ?, net_amount = ? WHERE id = ?').run(feeCents / 100, netCents / 100, txn.id);

  getWallet(txn.seller_id);
  db.prepare('UPDATE wallets SET available_cents = available_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(netCents, netCents, txn.seller_id);

  if (txn.promo_code) consumePromo(txn.promo_code);

  notify(txn.buyer_id, 'payment', 'Payment Released', `Payment of ${txn.amount} ${txn.currency} for "${txn.item_title}" has been released.`);
  notify(txn.seller_id, 'sale', 'Item Sold', `"${txn.item_title}" has been sold for ${txn.amount} ${txn.currency}!`);

  try {
    const buyer = db.prepare('SELECT email FROM users WHERE id = ?').get(txn.buyer_id);
    const seller = db.prepare('SELECT email FROM users WHERE id = ?').get(txn.seller_id);
    if (buyer?.email) {
      sendNotificationEmail(buyer.email, 'Your order is complete', `Your payment of ${txn.amount} ${txn.currency} for "${txn.item_title}" has been released to the seller. Thank you for shopping on TradeHub!`).catch(() => {});
    }
    if (seller?.email) {
      sendNotificationEmail(seller.email, 'You made a sale!', `Congratulations! "${txn.item_title}" was sold for ${txn.amount} ${txn.currency}. The funds are now in your wallet.`).catch(() => {});
    }
  } catch {}
  return true;
}

export async function refundTxn(txn, opts = {}) {
  if (!txn || txn.status === 'refunded') return false;

  const creditCents = txn.credit_cents || 0;
  const wasCompleted = txn.status === 'completed';

  // 1. Restore any store credit the buyer used (split or full-credit purchases).
  if (creditCents > 0) {
    restoreCredit(txn.buyer_id, creditCents);
  } else if (txn.method === 'credit' || txn.method === 'gift_card') {
    restoreCredit(txn.buyer_id, Math.round(txn.amount * 100));
  }

  // 2. Claw back the seller's balance if the payment had already been released.
  if (wasCompleted) {
    const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(txn.seller_id);
    if (w && (w.lifetime_cents > 0 || w.available_cents > 0)) {
      const amountCents = Math.round(txn.amount * 100);
      const feeCents = Math.round(amountCents * getFeeRateForSeller(txn.seller_id));
      const netCents = amountCents - feeCents;
      const available = Math.max(0, w.available_cents - netCents);
      const lifetime = Math.max(0, w.lifetime_cents - netCents);
      db.prepare('UPDATE wallets SET available_cents = ?, lifetime_cents = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(available, lifetime, txn.seller_id);
    }
    if (txn.promo_code) releasePromo(txn.promo_code);
  }

  // 3. Push the card portion back to the buyer through Paystack refunds.
  //    Skipped when `skipGateway` is set (e.g. this refund was created by the
  //    Paystack `refund.processed` webhook and the money is already returning).
  if (!opts.skipGateway && txn.paystack_reference && txn.paystack_reference.startsWith('demo_') === false && isPaystackConfigured()) {
    try {
      const amountMinor = toMinorUnits(Math.max(0, Math.round(txn.amount * 100) - creditCents) / 100, txn.currency || DEFAULT_CURRENCY);
      if (amountMinor > 0) {
        await paystack.request('POST', '/refund', {
          transaction: txn.paystack_reference,
          amount: amountMinor,
          currency: txn.currency || DEFAULT_CURRENCY,
        });
      }
    } catch (err) {
      logger.error(`Paystack refund failed for ${txn.id}: ${err.message}`);
    }
  }

  // 4. Update status + reactivate the item so it can be re-listed/sold.
  db.prepare("UPDATE transactions SET status = 'refunded', completed_at = NULL WHERE id = ?").run(txn.id);
  db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(txn.item_id);
  return true;
}

// ---- Transactions list / receipts ------------------------------------------

router.post('/confirm/:txnId', authenticateToken, (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.buyer_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'Not authorized' });
    if (txn.status !== 'pending') return res.status(400).json({ error: 'Payment is not in escrow' });
    finalizeCompleted(txn);
    res.json({ success: true });
  } catch (err) {
    logger.error('Confirm payment error:', err);
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
    logger.error('Get transactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/transactions/:txnId', authenticateToken, (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.buyer_id !== req.user.id && txn.seller_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(txn.item_id) || null;
    const buyer = db.prepare('SELECT id, name, email, avatar, rating, review_count FROM users WHERE id = ?').get(txn.buyer_id) || null;
    const seller = db.prepare('SELECT id, name, email, avatar, rating, review_count FROM users WHERE id = ?').get(txn.seller_id) || null;
    res.json({ receipt: { ...txn, item, buyer, seller } });
  } catch (err) {
    logger.error('Get receipt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/transactions/:txnId/confirm-receipt', authenticateToken, (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.buyer_id !== req.user.id) return res.status(403).json({ error: 'Only the buyer can confirm receipt' });
    if (txn.status !== 'pending') return res.status(400).json({ error: 'Payment is not in escrow' });
    finalizeCompleted(txn);
    res.json({ success: true });
  } catch (err) {
    logger.error('Confirm receipt error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refund/:txnId', authenticateToken, async (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.seller_id !== req.user.id && txn.buyer_id !== req.user.id && !req.user.isAdmin) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    await refundTxn(txn);
    notify(txn.buyer_id, 'system', 'Payment Refunded', `Payment for "${txn.item_title}" has been refunded.`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Refund error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Admin: manual fund confirmation fallback -------------------------------

router.post('/admin/fund-confirmed/:txnId', adminAuth, (req, res) => {
  try {
    const txn = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.txnId);
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    if (txn.status !== 'awaiting_payment') return res.status(400).json({ error: 'Transaction is not awaiting payment' });
    db.prepare("UPDATE transactions SET status = 'pending' WHERE id = ?").run(txn.id);
    notify(txn.buyer_id, 'payment', 'Payment Received', `We received your ${txn.method} payment for "${txn.item_title}". It is now held in escrow.`);
    res.json({ success: true });
  } catch (err) {
    logger.error('Confirm funds error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Seller analytics --------------------------------------------------------

router.get('/analytics/seller', authenticateToken, (req, res) => {
  try {
    const uid = req.user.id;

    const perItem = db.prepare(`
      SELECT i.id, i.title, i.views, i.favorites, i.status, i.created_at,
        (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) AS image,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS sold_count,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.net_amount ELSE 0 END), 0) AS revenue,
        MAX(CASE WHEN t.status = 'completed' THEN t.completed_at END) AS last_sale
      FROM items i
      LEFT JOIN transactions t ON t.item_id = i.id AND t.seller_id = i.seller_id
      WHERE i.seller_id = ?
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `).all(uid);

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(views), 0) AS views,
        COALESCE(SUM(favorites), 0) AS favorites,
        COUNT(*) AS listings,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
      FROM items WHERE seller_id = ?
    `).get(uid);

    const sales = db.prepare(`
      SELECT t.*, u.name AS buyer_name FROM transactions t
      LEFT JOIN users u ON u.id = t.buyer_id
      WHERE t.seller_id = ? AND t.status = 'completed'
      ORDER BY t.completed_at DESC LIMIT 20
    `).all(uid);

    const revenueTotals = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'completed' THEN net_amount ELSE 0 END), 0) AS completed,
        COALESCE(SUM(CASE WHEN status IN ('pending','awaiting_payment') THEN net_amount ELSE 0 END), 0) AS pending,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) AS sold
      FROM transactions WHERE seller_id = ?
    `).get(uid);

    res.json({
      perItem,
      totals: {
        views: totals?.views || 0,
        favorites: totals?.favorites || 0,
        listings: totals?.listings || 0,
        active: totals?.active || 0,
      },
      revenue: {
        completed: revenueTotals?.completed || 0,
        pending: revenueTotals?.pending || 0,
        sold: revenueTotals?.sold || 0,
      },
      sales,
    });
  } catch (err) {
    logger.error('Seller analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { toMajorUnits };

export default router;