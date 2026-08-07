import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import { validateAndApplyPromo } from './promotions.js';
import { sendNotificationEmail } from '../src/email.js';
import logger from '../src/logger.js';

const router = Router();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_KEY && !STRIPE_KEY.includes('placeholder') ? new Stripe(STRIPE_KEY) : null;
const FEE_RATE = Number(process.env.PAYMENT_FEE_PERCENT || 0) / 100;

const BANK_TRANSFER = {
  enabled: process.env.BANK_TRANSFER_ENABLED !== 'false',
  name: process.env.BANK_ACCOUNT_NAME || 'TradeHub Marketplace Ltd',
  bank: process.env.BANK_NAME || 'Example National Bank',
  accountNumber: process.env.BANK_ACCOUNT_NUMBER || '000123456789',
  routing: process.env.BANK_ROUTING || '021000021',
  swift: process.env.BANK_SWIFT || 'EXNBUS33',
  iban: process.env.BANK_IBAN || '',
};

const CRYPTO_NETWORK_META = {
  bitcoin: { id: 'bitcoin', label: 'Bitcoin', symbol: 'BTC' },
  ethereum: { id: 'ethereum', label: 'Ethereum', symbol: 'ETH' },
  usdt_erc20: { id: 'usdt_erc20', label: 'USDT (ERC-20)', symbol: 'USDT' },
  usdc_erc20: { id: 'usdc_erc20', label: 'USDC (ERC-20)', symbol: 'USDC' },
  solana: { id: 'solana', label: 'Solana', symbol: 'SOL' },
  litecoin: { id: 'litecoin', label: 'Litecoin', symbol: 'LTC' },
  dogecoin: { id: 'dogecoin', label: 'Dogecoin', symbol: 'DOGE' },
  tron: { id: 'tron', label: 'TRON (USDT-TRC20)', symbol: 'USDT' },
};

function getCryptoNetworks() {
  const configured = {};
  try {
    Object.assign(configured, JSON.parse(process.env.CRYPTO_ADDRESSES || '{}'));
  } catch {}
  for (const sym of ['BTC', 'ETH', 'USDT', 'USDC', 'SOL', 'LTC', 'DOGE', 'TRX']) {
    const v = process.env[`CRYPTO_ADDRESS_${sym}`];
    if (v) configured[sym.toLowerCase()] = v;
  }
  const list = (process.env.CRYPTO_NETWORKS || 'bitcoin,ethereum,usdt_erc20')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) list.push('bitcoin');
  const hasAnyConfig = Object.keys(configured).length > 0;
  const fallback = process.env.CRYPTO_ADDRESS;
  const networks = list.map((id) => {
    const meta = CRYPTO_NETWORK_META[id] || { id, label: id.toUpperCase(), symbol: id.toUpperCase() };
    const address = configured[id] || (hasAnyConfig ? '' : fallback);
    return { id: meta.id, label: meta.label, symbol: meta.symbol, address, configured: !!configured[id] };
  }).filter((n) => n.address);
  if (networks.length === 0) return [];
  if (!hasAnyConfig && fallback) {
    return networks.slice(0, 1).map((n) => ({ ...n, label: 'Crypto (unconfigured)', symbol: n.symbol }));
  }
  return networks;
}

function getCryptoPlaceholder() {
  const networks = getCryptoNetworks();
  return networks.length === 0 || networks.every((n) => !n.configured);
}

const GIFT_CARD_TYPES = ['digital', 'physical'];

const DEFAULT_BRANDS = [
  { name: 'Amazon Gift Card', category: 'retail', description: 'Shop anything on Amazon with this balance.', frontImage: '/uploads/amazon-gift-card.png' },
  { name: 'Apple Gift Card / iTunes Gift Card', category: 'digital', description: 'Apps, music, movies and more from Apple and iTunes.', frontImage: '/uploads/apple-itunes-gift-card.png' },
  { name: 'Walmart Gift Card', category: 'retail', description: 'Groceries, electronics, fashion and more at Walmart.', frontImage: '/uploads/walmart-gift-card.png' },
  { name: 'Starbucks Gift Card', category: 'food', description: 'Coffee, snacks and more at Starbucks.', frontImage: '/uploads/starbucks-gift-card.png' },
  { name: 'American Express & Visa Gift Cards', category: 'finance', description: 'Prepaid cards accepted anywhere American Express or Visa cards are.', frontImage: '/uploads/amex-visa-gift-card.jpg' },
  { name: 'Google Play Gift Card', category: 'digital', description: 'Apps, games, movies and books on Google Play.', frontImage: '/uploads/google-play-gift-card.jpg' },
  { name: 'Sephora Gift Card', category: 'retail', description: 'Beauty, makeup and skincare at Sephora.', frontImage: '/uploads/sephora-gift-card.jpg' },
  { name: 'TradeHub Gift Card', category: 'general', description: 'TradeHub store credit — redeemable for credit on any listing, boost or subscription.', frontImage: '/uploads/tradehub-gift-card.svg', backImage: '/uploads/tradehub-gift-card-back.svg' },
];

const BRAND_MERGES = [
  { from: 'Apple Gift Card', to: 'Apple Gift Card / iTunes Gift Card', description: 'Apps, music, movies and more from Apple and iTunes.' },
  { from: 'American Express Gift Card', to: 'American Express & Visa Gift Cards', description: 'Prepaid cards accepted anywhere American Express or Visa cards are.' },
];

const RETIRED_BRANDS = ['Steam', 'Netflix', 'iTunes Gift Card', 'Visa Gift Card'];

function seedDefaultBrands() {
  const find = (name) => db.prepare('SELECT * FROM gift_card_brands WHERE name = ?').get(name);

  for (const m of BRAND_MERGES) {
    const from = find(m.from);
    if (!from) continue;
    const to = find(m.to);
    if (to) {
      db.prepare('UPDATE gift_card_brands SET active = 0 WHERE id = ?').run(from.id);
    } else {
      db.prepare('UPDATE gift_card_brands SET name = ?, description = ? WHERE id = ?').run(m.to, m.description, from.id);
    }
  }

  const insert = db.prepare('INSERT INTO gift_card_brands (id, name, description, category) VALUES (?, ?, ?, ?)');
  for (const b of DEFAULT_BRANDS) {
    if (!find(b.name)) insert.run(uuidv4(), b.name, b.description, b.category);
  }
  for (const b of DEFAULT_BRANDS) {
    db.prepare('UPDATE gift_card_brands SET front_image = ? WHERE name = ? AND (front_image IS NULL OR front_image = \'\')').run(b.frontImage, b.name);
    if (b.backImage) {
      db.prepare('UPDATE gift_card_brands SET back_image = ? WHERE name = ? AND (back_image IS NULL OR back_image = \'\')').run(b.backImage, b.name);
    }
    db.prepare('UPDATE gift_card_brands SET active = 1 WHERE name = ?').run(b.name);
  }
  for (const name of RETIRED_BRANDS) {
    db.prepare('UPDATE gift_card_brands SET active = 0 WHERE name = ?').run(name);
  }
}

function randomCode(prefix, len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${out}`;
}

function generateGiftCode(prefix = 'TRADE') {
  const block = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };
  return `${prefix}-${block()}-${block()}-${block()}`;
}

function getWallet(userId) {
  let w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  if (!w) {
    db.prepare('INSERT INTO wallets (user_id) VALUES (?)').run(userId);
    w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(userId);
  }
  return w;
}

function insertTransaction({ txnId, item, amount, buyerId, sellerId, method, status, providerRef, paymentMethodId, promoCode, discountAmount, originalAmount, creditCents = 0 }) {
  const image = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(item.id)?.url || '';
  db.prepare(`
    INSERT INTO transactions (id, item_id, item_title, item_image, amount, buyer_id, seller_id, payment_method_id, stripe_payment_intent_id, method, provider_ref, status, promo_code, discount_amount, original_amount, credit_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    txnId, item.id, item.title, image, amount, buyerId, sellerId,
    paymentMethodId || null, providerRef && providerRef.startsWith('pi_') ? providerRef : null,
    method, providerRef || '', status,
    promoCode || '', discountAmount || 0, originalAmount || amount,
    creditCents || 0
  );
}

// ---- Store credit / gift card helpers --------------------------------------

function getGiftCard(code) {
  const card = db.prepare('SELECT * FROM gift_cards WHERE UPPER(code) = ?').get(String(code || '').trim().toUpperCase());
  if (!card) { const err = new Error('Invalid gift card code'); err.status = 400; throw err; }
  if (card.status === 'redeemed') { const err = new Error('Gift card already redeemed'); err.status = 400; throw err; }
  if (card.status === 'voided') { const err = new Error('Gift card has been voided'); err.status = 400; throw err; }
  if (card.balance_cents <= 0) { const err = new Error('Gift card has no balance'); err.status = 400; throw err; }
  if (card.expires_at && new Date(card.expires_at) < new Date()) { const err = new Error('Gift card has expired'); err.status = 400; throw err; }
  return card;
}

// Returns how much of `amountCents` can be covered by wallet credit + an optional gift card.
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

// Deducts `creditCents` from the buyer's gift card (first) and wallet credit.
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

// Returns credit to a buyer's wallet when a transaction is refunded/expired/cancelled.
function restoreCredit(userId, creditCents) {
  if (!creditCents || creditCents <= 0) return;
  getWallet(userId);
  db.prepare('UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(creditCents, userId);
}

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

// ---- Checkout helpers --------------------------------------------------------

export async function cancelStripeIntent(intentId) {
  if (!stripe || !intentId) return false;
  try {
    await stripe.paymentIntents.cancel(intentId);
    return true;
  } catch (err) {
    logger.warn(`Stripe intent cancel failed ${intentId}: ${err.message}`);
    return false;
  }
}

// Marks an awaiting_payment transaction as expired: restores any store credit
// used and cancels any open Stripe intent for it.
export async function expireAwaitingPayment(txn) {
  if (!txn || txn.status !== 'awaiting_payment') return false;
  restoreCredit(txn.buyer_id, txn.credit_cents || 0);
  if (txn.stripe_payment_intent_id) await cancelStripeIntent(txn.stripe_payment_intent_id);
  db.prepare("UPDATE transactions SET status = 'expired', completed_at = NULL WHERE id = ?").run(txn.id);
  notify(txn.buyer_id, 'payment', 'Payment Expired', `Your pending payment for "${txn.item_title}" expired and was cancelled. Any store credit used has been returned.`);
  return true;
}

export function finalizeCompleted(txn) {
  if (!txn || txn.status === 'completed') return false;
  db.prepare("UPDATE transactions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(txn.id);
  db.prepare("UPDATE items SET status = 'sold' WHERE id = ?").run(txn.item_id);

  const amountCents = Math.round(txn.amount * 100);
  const feeCents = Math.round(amountCents * FEE_RATE);
  const netCents = amountCents - feeCents;
  db.prepare('UPDATE transactions SET fee_amount = ?, net_amount = ? WHERE id = ?').run(feeCents / 100, netCents / 100, txn.id);

  getWallet(txn.seller_id);
  db.prepare('UPDATE wallets SET available_cents = available_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(netCents, netCents, txn.seller_id);

  notify(txn.buyer_id, 'payment', 'Payment Released', `Payment of $${txn.amount} for "${txn.item_title}" has been released.`);
  notify(txn.seller_id, 'sale', 'Item Sold', `"${txn.item_title}" has been sold for $${txn.amount}!`);

  try {
    const buyer = db.prepare('SELECT email FROM users WHERE id = ?').get(txn.buyer_id);
    const seller = db.prepare('SELECT email FROM users WHERE id = ?').get(txn.seller_id);
    if (buyer?.email) {
      sendNotificationEmail(buyer.email, 'Your order is complete', `Your payment of $${txn.amount} for "${txn.item_title}" has been released to the seller. Thank you for shopping on TradeHub!`).catch(() => {});
    }
    if (seller?.email) {
      sendNotificationEmail(seller.email, 'You made a sale!', `Congratulations! "${txn.item_title}" was sold for $${txn.amount}. The funds are now in your wallet.`).catch(() => {});
    }
  } catch {}
  return true;
}

export async function refundTxn(txn) {
  if (!txn || txn.status === 'refunded') return false;

  const creditCents = txn.credit_cents || 0;
  const wasCompleted = txn.status === 'completed';

  // 1. Restore any store credit the buyer used (split or full-credit purchases).
  if (creditCents > 0) {
    restoreCredit(txn.buyer_id, creditCents);
  } else if (txn.method === 'credit' || txn.method === 'gift_card') {
    // Legacy credit purchase before credit_cents was tracked.
    restoreCredit(txn.buyer_id, Math.round(txn.amount * 100));
  }

  // 2. Claw back the seller's balance if the payment had already been released.
  if (wasCompleted) {
    const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(txn.seller_id);
    if (w && (w.lifetime_cents > 0 || w.available_cents > 0)) {
      const amountCents = Math.round(txn.amount * 100);
      const feeCents = Math.round(amountCents * FEE_RATE);
      const netCents = amountCents - feeCents;
      const available = Math.max(0, w.available_cents - netCents);
      const lifetime = Math.max(0, w.lifetime_cents - netCents);
      db.prepare('UPDATE wallets SET available_cents = ?, lifetime_cents = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
        .run(available, lifetime, txn.seller_id);
    }
  }

  // 3. Issue a real Stripe refund for the card portion actually charged.
  if (txn.stripe_payment_intent_id && stripe) {
    const chargedCents = Math.max(0, Math.round(txn.amount * 100) - creditCents);
    if (chargedCents > 0) {
      try {
        await stripe.refunds.create({ payment_intent: txn.stripe_payment_intent_id, amount: chargedCents });
      } catch (err) {
        logger.error(`Stripe refund failed for ${txn.id}: ${err.message}`);
      }
    }
  }

  // 4. Update status + reactivate item.
  db.prepare("UPDATE transactions SET status = 'refunded', completed_at = NULL WHERE id = ?").run(txn.id);
  db.prepare("UPDATE items SET status = 'active' WHERE id = ?").run(txn.item_id);
  return true;
}

// ---- Saved card methods --------------------------------------------------

router.get('/methods', authenticateToken, (req, res) => {
  try {
    const methods = db.prepare(
      'SELECT id, brand, last4, exp_month, exp_year, is_default, created_at FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC'
    ).all(req.user.id);
    res.json({ methods });
  } catch (err) {
    logger.error('Get payment methods error:', err);
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

// ---- Wallet / gift cards --------------------------------------------------

router.get('/wallet', authenticateToken, (req, res) => {
  try {
    res.json({ wallet: getWallet(req.user.id) });
  } catch (err) {
    logger.error('Get wallet error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/options', authenticateToken, (req, res) => {
  try {
    const wallet = getWallet(req.user.id);
    res.json({
      feePercent: Math.round(FEE_RATE * 100),
      methods: [
        {
          id: 'card',
          name: 'Card / Stripe',
          enabled: true,
          description: 'Pay instantly with any credit or debit card, Apple Pay or Google Pay.',
          live: !!stripe,
        },
        {
          id: 'bank',
          name: 'Bank Transfer',
          enabled: BANK_TRANSFER.enabled,
          description: 'Pay by direct bank transfer. Funds are verified by the platform before escrow.',
          details: { ...BANK_TRANSFER, enabled: undefined },
        },
        {
          id: 'crypto',
          name: 'Crypto',
          enabled: process.env.CRYPTO_ENABLED !== 'false',
          description: 'Pay with Bitcoin, Ethereum, USDT and more. Choose a network at checkout.',
          details: { networks: getCryptoNetworks(), placeholder: getCryptoPlaceholder() },
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

// ---- Gift card brands -----------------------------------------------------

router.get('/gift-cards/brands', authenticateToken, (req, res) => {
  try {
    seedDefaultBrands();
    const brands = db.prepare('SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name').all();
    res.json({ brands });
  } catch (err) {
    logger.error('List gift card brands error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/gift-cards/brands/all', adminAuth, (req, res) => {
  try {
    seedDefaultBrands();
    const brands = db.prepare('SELECT * FROM gift_card_brands ORDER BY active DESC, name').all();
    res.json({ brands });
  } catch (err) {
    logger.error('List all brands error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/gift-cards/brands', adminAuth, (req, res) => {
  try {
    const { name, description = '', category = 'general', frontImage = '', backImage = '', active = 1 } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Brand name required' });
    const id = uuidv4();
    db.prepare(`
      INSERT INTO gift_card_brands (id, name, description, category, front_image, back_image, active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), description, category, frontImage, backImage, active ? 1 : 0);
    res.status(201).json({ brand: db.prepare('SELECT * FROM gift_card_brands WHERE id = ?').get(id) });
  } catch (err) {
    logger.error('Create brand error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/gift-cards/brands/:id', adminAuth, (req, res) => {
  try {
    const brand = db.prepare('SELECT * FROM gift_card_brands WHERE id = ?').get(req.params.id);
    if (!brand) return res.status(404).json({ error: 'Brand not found' });
    const { name, description, category, frontImage, backImage, active } = req.body;
    const next = {
      name: name?.trim() || brand.name,
      description: description !== undefined ? description : brand.description,
      category: category || brand.category,
      frontImage: frontImage !== undefined ? frontImage : brand.front_image,
      backImage: backImage !== undefined ? backImage : brand.back_image,
      active: active !== undefined ? (active ? 1 : 0) : brand.active,
    };
    db.prepare(`
      UPDATE gift_card_brands SET name = ?, description = ?, category = ?, front_image = ?, back_image = ?, active = ?
      WHERE id = ?
    `).run(next.name, next.description, next.category, next.frontImage, next.backImage, next.active, brand.id);
    res.json({ brand: db.prepare('SELECT * FROM gift_card_brands WHERE id = ?').get(brand.id) });
  } catch (err) {
    logger.error('Update brand error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/gift-cards/brands/:id', adminAuth, (req, res) => {
  try {
    db.prepare('UPDATE gift_card_brands SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Deactivate brand error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Gift card mall (public) + design submissions --------------------------

router.get('/gift-cards/mall', (req, res) => {
  try {
    seedDefaultBrands();
    const brands = db.prepare('SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name').all();
    res.json({ brands, canSubmit: true });
  } catch (err) {
    logger.error('Gift card mall error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/gift-cards/designs', authenticateToken, (req, res) => {
  try {
    const { imageUrl, brandId = null, note = '' } = req.body;
    if (!imageUrl || !String(imageUrl).trim()) return res.status(400).json({ error: 'Card image required' });
    if (!String(imageUrl).startsWith('/uploads/')) return res.status(400).json({ error: 'Card image must be an uploaded file' });
    if (brandId && !db.prepare('SELECT id FROM gift_card_brands WHERE id = ?').get(brandId)) {
      return res.status(404).json({ error: 'Brand not found' });
    }
    const id = uuidv4();
    db.prepare(`
      INSERT INTO gift_card_designs (id, user_id, brand_id, image_url, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, req.user.id, brandId || null, String(imageUrl).trim(), String(note || '').slice(0, 500));
    res.status(201).json({ success: true, design: db.prepare(`
      SELECT d.*, u.name as user_name, b.name as brand_name
      FROM gift_card_designs d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN gift_card_brands b ON b.id = d.brand_id
      WHERE d.id = ?
    `).get(id) });
  } catch (err) {
    logger.error('Submit design error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/gift-cards/designs', adminAuth, (req, res) => {
  try {
    const { status = 'all' } = req.query;
    let query = `
      SELECT d.*, u.name as user_name, b.name as brand_name, b.front_image as brand_front_image
      FROM gift_card_designs d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN gift_card_brands b ON b.id = d.brand_id
    `;
    const params = [];
    if (status !== 'all') { query += ' WHERE d.status = ?'; params.push(status); }
    query += ' ORDER BY d.created_at DESC LIMIT 200';
    res.json({ designs: db.prepare(query).all(...params) });
  } catch (err) {
    logger.error('List designs error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/gift-cards/designs/:id/status', adminAuth, (req, res) => {
  try {
    const { status } = req.body;
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const design = db.prepare('SELECT id FROM gift_card_designs WHERE id = ?').get(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    db.prepare("UPDATE gift_card_designs SET status = ? WHERE id = ?").run(status, design.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Update design status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Gift card issue / analytics / management -------------------------------

router.post('/gift-cards/issue', adminAuth, (req, res) => {
  try {
    const { amountCents, count = 1, note = '', brandId = null, cardType = 'digital', purchaseCents = null, discountPercent = 0 } = req.body;
    const amount = Math.round(Number(amountCents));
    const qty = Math.min(Math.max(parseInt(count, 10) || 1, 1), 100);
    if (!amount || amount < 100) return res.status(400).json({ error: 'Amount must be at least $1.00' });
    if (!GIFT_CARD_TYPES.includes(cardType)) return res.status(400).json({ error: 'Invalid card type' });

    let prefix = 'TRADE';
    if (brandId) {
      const brand = db.prepare('SELECT * FROM gift_card_brands WHERE id = ?').get(brandId);
      if (!brand) return res.status(404).json({ error: 'Brand not found' });
      prefix = (brand.name || 'TRADE').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'TRADE';
    }

    const discount = Math.min(Math.max(parseFloat(discountPercent) || 0, 0), 90);
    const purchase = purchaseCents != null
      ? Math.round(Number(purchaseCents))
      : Math.round(amount * (1 - discount / 100));

    const codes = [];
    for (let i = 0; i < qty; i++) {
      const code = generateGiftCode(prefix);
      db.prepare(`
        INSERT INTO gift_cards (id, code, brand_id, card_type, original_cents, purchase_cents, balance_cents, issued_by, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), code, brandId, cardType, amount, purchase, amount, req.adminId, note);
      codes.push(code);
    }
    res.status(201).json({ codes, amountCents: amount, purchaseCents: purchase, brandId, cardType });
  } catch (err) {
    logger.error('Issue gift cards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/gift-cards/analytics', adminAuth, (req, res) => {
  try {
    const issued = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(original_cents),0) as v, COALESCE(SUM(purchase_cents),0) as p FROM gift_cards").get();
    const redeemed = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(original_cents),0) as v FROM gift_cards WHERE status = 'redeemed'").get();
    const active = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(balance_cents),0) as v FROM gift_cards WHERE status = 'active'").get();
    const voided = db.prepare("SELECT COUNT(*) as c FROM gift_cards WHERE status = 'voided'").get().c;
    const margin = Math.max(0, issued.v - (issued.p || 0));
    const byBrand = db.prepare(`
      SELECT b.id, b.name, COUNT(g.id) as issued, COALESCE(SUM(g.original_cents),0) as value,
             COALESCE(SUM(CASE WHEN g.status='redeemed' THEN g.original_cents END),0) as redeemed_value
      FROM gift_card_brands b LEFT JOIN gift_cards g ON g.brand_id = b.id
      GROUP BY b.id ORDER BY issued DESC
    `).all();
    res.json({
      analytics: {
        issuedCount: issued.c, issuedValue: issued.v, purchaseValue: issued.p,
        redeemedCount: redeemed.c, redeemedValue: redeemed.v,
        activeCount: active.c, activeValue: active.v,
        voidedCount: voided,
        margin,
        byBrand,
      },
    });
  } catch (err) {
    logger.error('Gift card analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/gift-cards/list', adminAuth, (req, res) => {
  try {
    const { status = 'all', limit = 50 } = req.query;
    let query = `
      SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image
      FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id
    `;
    const params = [];
    if (status !== 'all') { query += ' WHERE g.status = ?'; params.push(status); }
    query += ' ORDER BY g.created_at DESC LIMIT ?';
    params.push(Math.min(parseInt(limit, 10) || 50, 200));
    res.json({ cards: db.prepare(query).all(...params) });
  } catch (err) {
    logger.error('List gift cards error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/gift-cards/:id/void', adminAuth, (req, res) => {
  try {
    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Gift card not found' });
    if (card.status !== 'active') return res.status(400).json({ error: 'Only active cards can be voided' });
    db.prepare("UPDATE gift_cards SET status = 'voided', balance_cents = 0, voided_at = datetime('now'), voided_by = ? WHERE id = ?")
      .run(req.adminId, card.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Void gift card error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/gift-cards/:id/reset', adminAuth, (req, res) => {
  try {
    const card = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Gift card not found' });
    if (!['redeemed', 'voided', 'expired'].includes(card.status)) {
      return res.status(400).json({ error: 'Only redeemed, voided or expired cards can be reset' });
    }
    if (card.status === 'redeemed' && card.redeemed_by && card.original_cents > 0) {
      const w = db.prepare('SELECT * FROM wallets WHERE user_id = ?').get(card.redeemed_by);
      if (w) {
        const credit = Math.max(0, w.credit_cents - card.original_cents);
        db.prepare('UPDATE wallets SET credit_cents = ?, updated_at = datetime(\'now\') WHERE user_id = ?')
          .run(credit, card.redeemed_by);
      }
    }
    db.prepare(`
      UPDATE gift_cards SET status = 'active', balance_cents = ?, redeemed_by = NULL, redeemed_at = NULL, voided_at = NULL, voided_by = NULL
      WHERE id = ?
    `).run(card.original_cents, card.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Reset gift card error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function redeemGiftCard(code, userId) {
  const card = db.prepare('SELECT * FROM gift_cards WHERE UPPER(code) = ?').get(String(code || '').trim().toUpperCase());
  if (!card) throw new Error('Invalid gift card code');
  if (card.status === 'redeemed') throw new Error('Gift card already redeemed');
  if (card.status === 'voided') throw new Error('Gift card has been voided');
  if (card.balance_cents <= 0) throw new Error('Gift card has no balance');
  if (card.expires_at && new Date(card.expires_at) < new Date()) throw new Error('Gift card has expired');
  const balance = card.balance_cents;
  db.prepare("UPDATE gift_cards SET status = 'redeemed', balance_cents = 0, redeemed_by = ?, redeemed_at = datetime('now') WHERE id = ?")
    .run(userId, card.id);
  getWallet(userId);
  db.prepare('UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime(\'now\') WHERE user_id = ?')
    .run(balance, userId);
  return balance;
}

router.post('/gift-cards/redeem', authenticateToken, (req, res) => {
  try {
    const { code } = req.body;
    const balance = redeemGiftCard(code, req.user.id);
    const card = db.prepare(`
      SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image
      FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id
      WHERE g.id = ?
    `).get(db.prepare('SELECT id FROM gift_cards WHERE UPPER(code) = ?').get(String(code || '').trim().toUpperCase()).id);
    res.json({ success: true, creditCents: getWallet(req.user.id).credit_cents, balanceCents: balance, card });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Checkout --------------------------------------------------------------

router.post('/create-intent', authenticateToken, async (req, res) => {
  try {
    const { itemId, paymentMethodId, method = 'card', giftCardCode, network, promoCode, useCredit } = req.body;
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id === req.user.id) return res.status(400).json({ error: 'Cannot buy your own item' });
    if (item.status === 'sold') return res.status(400).json({ error: 'Item is already sold' });

    const baseAmount = item.sale_price || item.price;
    const txnId = uuidv4();

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

    // Split / mixed payments: cover part of the order with store credit or a gift
    // card and charge the remainder with the chosen method.
    const wantsCredit = method === 'credit' || method === 'gift_card' || !!giftCardCode || useCredit === true;
    let creditCents = 0;
    let giftCard = null;
    if (wantsCredit) {
      const calc = calculateCredit(req.user.id, giftCardCode, amountCents);
      creditCents = calc.creditCents;
      giftCard = calc.giftCard;
    }
    if (method === 'credit' || method === 'gift_card') {
      if (creditCents < amountCents) {
        return res.status(402).json({ error: 'Insufficient store credit', creditCents, amountCents });
      }
    }
    const chargeCents = amountCents - creditCents;

    // Fully covered by credit / gift card.
    if (chargeCents === 0) {
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      insertTransaction({ txnId, item, amount, buyerId: req.user.id, sellerId: item.seller_id, method: 'credit', status: 'pending', providerRef: 'CREDIT', paymentMethodId, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: baseAmount, creditCents });
      return res.json({ transactionId: txnId, status: 'pending', method: 'credit', paid: true, amountCents, creditCents, promo: promoInfo });
    }

    if (method === 'bank') {
      const reference = randomCode('BNK');
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      insertTransaction({ txnId, item, amount, buyerId: req.user.id, sellerId: item.seller_id, method: 'bank', status: 'awaiting_payment', providerRef: reference, paymentMethodId, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: baseAmount, creditCents });
      return res.json({
        transactionId: txnId,
        status: 'awaiting_payment',
        method: 'bank',
        promo: promoInfo,
        creditCents,
        payment: { bank: { name: BANK_TRANSFER.name, bank: BANK_TRANSFER.bank, accountNumber: BANK_TRANSFER.accountNumber, routing: BANK_TRANSFER.routing, swift: BANK_TRANSFER.swift, iban: BANK_TRANSFER.iban }, reference, amountCents: chargeCents, amount: chargeCents / 100 },
      });
    }

    if (method === 'crypto') {
      const networks = getCryptoNetworks();
      const reference = randomCode('CRY');
      const selected = network ? networks.find((n) => n.id === network || n.symbol.toLowerCase() === String(network).toLowerCase()) : networks[0];
      if (!selected) return res.status(400).json({ error: 'Invalid crypto network' });
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      insertTransaction({ txnId, item, amount, buyerId: req.user.id, sellerId: item.seller_id, method: 'crypto', status: 'awaiting_payment', providerRef: reference, paymentMethodId, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: baseAmount, creditCents });
      const qr = `${selected.id}:${selected.address}?amount=${chargeCents / 100}`;
      return res.json({
        transactionId: txnId,
        status: 'awaiting_payment',
        method: 'crypto',
        promo: promoInfo,
        creditCents,
        payment: {
          address: selected.address,
          network: { id: selected.id, label: selected.label, symbol: selected.symbol },
          networks,
          reference,
          amountCents: chargeCents,
          amount: chargeCents / 100,
          qr,
          placeholder: getCryptoPlaceholder(),
        },
      });
    }

    // Card / Stripe
    if (!stripe) {
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      insertTransaction({ txnId, item, amount, buyerId: req.user.id, sellerId: item.seller_id, method: 'card', status: 'pending', providerRef: `demo_${txnId}`, paymentMethodId, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: baseAmount, creditCents });
      return res.json({ clientSecret: 'demo_secret', transactionId: txnId, demo: true, status: 'pending', promo: promoInfo, creditCents });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: 'usd',
      metadata: { itemId, buyerId: req.user.id, sellerId: item.seller_id },
      automatic_payment_methods: { enabled: true },
    });
    applyCredit({ userId: req.user.id, giftCard, creditCents });
    insertTransaction({ txnId, item, amount, buyerId: req.user.id, sellerId: item.seller_id, method: 'card', status: 'awaiting_payment', providerRef: paymentIntent.id, paymentMethodId, promoCode: promoCodeUsed, discountAmount: promoDiscount, originalAmount: baseAmount, creditCents });
    res.json({ clientSecret: paymentIntent.client_secret, transactionId: txnId, status: 'awaiting_payment', promo: promoInfo, creditCents });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error('Create intent error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Cart --------------------------------------------------------------------

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
    const { method = 'card', paymentMethodId, giftCardCode, network, promoCode } = req.body;
    const cartItems = getCart(req.user.id);
    if (!cartItems.length) return res.status(400).json({ error: 'Your cart is empty' });

    const lines = [];
    for (const line of cartItems) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(line.item_id);
      if (!item) { const e = new Error(`Item no longer exists`); e.status = 400; throw e; }
      if (item.seller_id === req.user.id) { const e = new Error(`Cannot buy your own item`); e.status = 400; throw e; }
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

    // Allocate promo discount proportionally across lines.
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
    // Fix any rounding drift so line amounts exactly match the discounted total.
    if (promoDiscount > 0) {
      const expected = Math.round((subtotal - promoDiscount) * 100);
      const drift = expected - totalCents;
      if (drift !== 0) {
        allocated[allocated.length - 1].lineNetCents += drift;
        allocated[allocated.length - 1].lineDiscountCents -= drift;
        totalCents = expected;
      }
    }

    // Split: apply available store credit / gift card toward the order.
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
    const insertLine = (line, index, method, status, providerRef) => {
      const item = line.item;
      insertTransaction({
        txnId: txnIds[index],
        item,
        amount: line.lineNetCents / 100,
        buyerId: req.user.id,
        sellerId: item.seller_id,
        method,
        status,
        providerRef,
        paymentMethodId,
        promoCode: promoCodeUsed,
        discountAmount: line.lineDiscountCents / 100,
        originalAmount: line.baseAmount,
        creditCents: line.lineCreditCents,
      });
    };

    if (chargeCents === 0) {
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      allocated.forEach((l, i) => insertLine(l, i, 'credit', 'pending', 'CREDIT'));
      db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
      return res.json({ paid: true, status: 'pending', method: 'credit', transactionIds: txnIds, totalCents, creditCents, count: allocated.length, promo: promoInfo });
    }

    if (method === 'bank') {
      const reference = randomCode('BNK');
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      allocated.forEach((l, i) => insertLine(l, i, 'bank', 'awaiting_payment', reference));
      db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
      return res.json({
        transactionIds: txnIds,
        status: 'awaiting_payment',
        method: 'bank',
        promo: promoInfo,
        creditCents,
        payment: { bank: { name: BANK_TRANSFER.name, bank: BANK_TRANSFER.bank, accountNumber: BANK_TRANSFER.accountNumber, routing: BANK_TRANSFER.routing, swift: BANK_TRANSFER.swift, iban: BANK_TRANSFER.iban }, reference, amountCents: chargeCents, amount: chargeCents / 100 },
      });
    }

    if (method === 'crypto') {
      const networks = getCryptoNetworks();
      const reference = randomCode('CRY');
      const selected = network ? networks.find((n) => n.id === network || n.symbol.toLowerCase() === String(network).toLowerCase()) : networks[0];
      if (!selected) return res.status(400).json({ error: 'Invalid crypto network' });
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      allocated.forEach((l, i) => insertLine(l, i, 'crypto', 'awaiting_payment', reference));
      db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
      return res.json({
        transactionIds: txnIds,
        status: 'awaiting_payment',
        method: 'crypto',
        promo: promoInfo,
        creditCents,
        payment: {
          address: selected.address,
          network: { id: selected.id, label: selected.label, symbol: selected.symbol },
          networks,
          reference,
          amountCents: chargeCents,
          amount: chargeCents / 100,
          qr: `${selected.id}:${selected.address}?amount=${chargeCents / 100}`,
          placeholder: getCryptoPlaceholder(),
        },
      });
    }

    // Card / Stripe
    if (!stripe) {
      applyCredit({ userId: req.user.id, giftCard, creditCents });
      allocated.forEach((l, i) => insertLine(l, i, 'card', 'pending', `demo_${txnIds[i]}`));
      db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
      return res.json({ demo: true, paid: true, status: 'pending', clientSecret: 'demo_secret', transactionIds: txnIds, totalCents, creditCents, count: allocated.length, promo: promoInfo });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: 'usd',
      metadata: { itemIds: allocated.map((l) => l.item.id), buyerId: req.user.id },
      automatic_payment_methods: { enabled: true },
    });
    applyCredit({ userId: req.user.id, giftCard, creditCents });
    allocated.forEach((l, i) => insertLine(l, i, 'card', 'awaiting_payment', paymentIntent.id));
    db.prepare('DELETE FROM carts WHERE user_id = ?').run(req.user.id);
    res.json({ clientSecret: paymentIntent.client_secret, status: 'awaiting_payment', transactionIds: txnIds, totalCents, chargeCents, creditCents, count: allocated.length, promo: promoInfo });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    logger.error('Cart checkout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Manual fund confirmation (bank / crypto received) ----------------------

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

export default router;
