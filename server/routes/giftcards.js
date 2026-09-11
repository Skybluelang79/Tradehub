import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { adminAuth } from '../middleware/adminAuth.js';
import logger from '../src/logger.js';

const router = Router();

const GIFT_CARD_TYPES = ['digital', 'physical'];

const DEFAULT_BRANDS = [
  { name: 'Amazon Gift Card', category: 'retail', description: 'Shop anything on Amazon with this balance.', frontImage: '/uploads/amazon-gift-card.png' },
  { name: 'Apple Gift Card / iTunes Gift Card', category: 'digital', description: 'Apps, music, movies and more from Apple and iTunes.', frontImage: '/uploads/apple-itunes-gift-card.png' },
  { name: 'Walmart Gift Card', category: 'retail', description: 'Groceries, electronics, fashion and more at Walmart.', frontImage: '/uploads/walmart-gift-card.png' },
  { name: 'Starbucks Gift Card', category: 'food', description: 'Coffee, snacks and more at Starbucks.', frontImage: '/uploads/starbucks-gift-card.png' },
  { name: 'American Express & Visa Gift Cards', category: 'finance', description: 'Prepaid cards accepted anywhere American Express or Visa cards are.', frontImage: '/uploads/amex-visa-gift-card.jpg' },
  { name: 'Google Play Gift Card', category: 'digital', description: 'Apps, games, movies and books on Google Play.', frontImage: '/uploads/google-play-gift-card.jpg' },
  { name: 'Sephora Gift Card', category: 'retail', description: 'Beauty, makeup and skincare at Sephora.', frontImage: '/uploads/sephora-gift-card.jpg' },
  { name: 'TradeHub Gift Card', category: 'general', description: "TradeHub's all-purpose gift card. Redeem for store credit to use on any listing, listing boost or subscription on the marketplace.", frontImage: '/uploads/tradehub-gift-card.svg', backImage: '/uploads/tradehub-gift-card-back.svg' },
];

const BRAND_MERGES = [
  { from: 'Apple Gift Card', to: 'Apple Gift Card / iTunes Gift Card', description: 'Apps, music, movies and more from Apple and iTunes.' },
  { from: 'American Express Gift Card', to: 'American Express & Visa Gift Cards', description: 'Prepaid cards accepted anywhere American Express or Visa cards are.' },
  { from: 'Amazon', to: 'Amazon Gift Card', description: 'Shop anything on Amazon with this balance.' },
  { from: 'Starbucks', to: 'Starbucks Gift Card', description: 'Coffee, snacks and more at Starbucks.' },
];

const RETIRED_BRANDS = ['Steam', 'Netflix', 'iTunes Gift Card', 'Visa Gift Card', 'Amazon', 'Starbucks', 'Smoke Brand'];

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
    db.prepare("UPDATE gift_card_brands SET front_image = ? WHERE name = ? AND (front_image IS NULL OR front_image = '')").run(b.frontImage, b.name);
    if (b.backImage) {
      db.prepare("UPDATE gift_card_brands SET back_image = ? WHERE name = ? AND (back_image IS NULL OR back_image = '')").run(b.backImage, b.name);
    }
    db.prepare('UPDATE gift_card_brands SET active = 1 WHERE name = ?').run(b.name);
  }
  for (const name of RETIRED_BRANDS) {
    db.prepare('UPDATE gift_card_brands SET active = 0 WHERE name = ?').run(name);
  }
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
  db.prepare("UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime('now') WHERE user_id = ?")
    .run(balance, userId);
  return balance;
}

// ---- Brands -----------------------------------------------------------------

router.get('/brands', authenticateToken, (req, res) => {
  try {
    seedDefaultBrands();
    const brands = db.prepare('SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name').all();
    res.json({ brands });
  } catch (err) {
    logger.error('List gift card brands error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/brands/all', adminAuth, (req, res) => {
  try {
    seedDefaultBrands();
    const brands = db.prepare('SELECT * FROM gift_card_brands ORDER BY active DESC, name').all();
    res.json({ brands });
  } catch (err) {
    logger.error('List all brands error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/brands', adminAuth, (req, res) => {
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

router.put('/brands/:id', adminAuth, (req, res) => {
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

router.delete('/brands/:id', adminAuth, (req, res) => {
  try {
    db.prepare('UPDATE gift_card_brands SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Deactivate brand error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Gift card mall (public) + design submissions ---------------------------

router.get('/mall', (req, res) => {
  try {
    seedDefaultBrands();
    const brands = db.prepare('SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name').all();
    res.json({ brands, canSubmit: true });
  } catch (err) {
    logger.error('Gift card mall error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/designs', authenticateToken, (req, res) => {
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

router.get('/designs', adminAuth, (req, res) => {
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

router.put('/designs/:id/status', adminAuth, (req, res) => {
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

// ---- Issue / analytics / management -----------------------------------------

router.post('/issue', adminAuth, (req, res) => {
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

router.get('/analytics', adminAuth, (req, res) => {
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

router.get('/list', adminAuth, (req, res) => {
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

router.post('/:id/void', adminAuth, (req, res) => {
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

router.post('/:id/reset', adminAuth, (req, res) => {
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
        db.prepare("UPDATE wallets SET credit_cents = ?, updated_at = datetime('now') WHERE user_id = ?")
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

router.post('/redeem', authenticateToken, (req, res) => {
  try {
    const { code } = req.body;
    const balance = redeemGiftCard(code, req.user.id);
    const cardRow = db.prepare(`
      SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image
      FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id
      WHERE g.id = ?
    `).get(db.prepare('SELECT id FROM gift_cards WHERE UPPER(code) = ?').get(String(code || '').trim().toUpperCase()).id);
    res.json({ success: true, creditCents: getWallet(req.user.id).credit_cents, balanceCents: balance, card: cardRow });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;