import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import validate, { createPromotionSchema } from '../src/validation.js';
import logger from '../src/logger.js';

const router = Router();

export function validateAndApplyPromo(code, amount) {
  if (!code || !String(code).trim()) return { discount: 0, promo: null };

  const promo = db.prepare(`
    SELECT * FROM promotions
    WHERE code = ? AND active = 1
    AND (max_uses = 0 OR used_count < max_uses)
    AND (expires_at IS NULL OR expires_at > datetime('now'))
  `).get(String(code).trim().toUpperCase());

  if (!promo) {
    const err = new Error('Invalid or expired promotion code');
    err.status = 400;
    throw err;
  }

  if (promo.min_purchase && amount < promo.min_purchase) {
    const err = new Error(`Minimum purchase of $${promo.min_purchase} required`);
    err.status = 400;
    throw err;
  }

  let discount = 0;
  if (promo.discount_type === 'percentage') {
    discount = amount * (promo.discount_value / 100);
    discount = Math.min(discount, amount);
  } else {
    discount = Math.min(promo.discount_value, amount);
  }
  discount = Math.round(discount * 100) / 100;

  db.prepare('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?').run(promo.id);
  if (promo.max_uses > 0 && promo.used_count + 1 >= promo.max_uses) {
    db.prepare('UPDATE promotions SET active = 0 WHERE id = ?').run(promo.id);
  }

  return { discount, promo };
}

router.post('/', authenticateToken, validate(createPromotionSchema), (req, res) => {
  try {
    const { code, discount_type, discount_value, max_uses, expires_at, min_purchase } = req.validatedBody;

    const existing = db.prepare('SELECT id FROM promotions WHERE code = ?').get(code.toUpperCase());
    if (existing) {
      return res.status(409).json({ error: 'Promotion code already exists' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO promotions (id, code, discount_type, discount_value, max_uses, expires_at, min_purchase)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, code.toUpperCase(), discount_type, discount_value, max_uses || 0, expires_at || null, min_purchase || null);

    const promo = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    res.status(201).json({ promotion: promo });
  } catch (err) {
    logger.error('Create promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticateToken, (req, res) => {
  try {
    const promotions = db.prepare('SELECT * FROM promotions ORDER BY created_at DESC').all();
    res.json({ promotions });
  } catch (err) {
    logger.error('Get promotions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/validate', (req, res) => {
  try {
    const { code, amount } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const promo = db.prepare(`
      SELECT * FROM promotions
      WHERE code = ? AND active = 1
      AND (max_uses = 0 OR used_count < max_uses)
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(code.toUpperCase());

    if (!promo) {
      return res.status(400).json({ error: 'Invalid or expired promotion code' });
    }

    if (promo.min_purchase && amount && amount < promo.min_purchase) {
      return res.status(400).json({
        error: `Minimum purchase of $${promo.min_purchase} required`,
        min_purchase: promo.min_purchase,
      });
    }

    let discount = 0;
    if (promo.discount_type === 'percentage') {
      discount = (amount || 0) * (promo.discount_value / 100);
      discount = Math.min(discount, (amount || 0));
    } else {
      discount = promo.discount_value;
      if (amount) discount = Math.min(discount, amount);
    }

    res.json({
      valid: true,
      promotion: promo,
      discount: Math.round(discount * 100) / 100,
    });
  } catch (err) {
    logger.error('Validate promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/apply', (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });

    const promo = db.prepare('SELECT * FROM promotions WHERE code = ? AND active = 1').get(code.toUpperCase());
    if (!promo) return res.status(400).json({ error: 'Invalid code' });

    db.prepare('UPDATE promotions SET used_count = used_count + 1 WHERE id = ?').run(promo.id);

    if (promo.max_uses > 0 && promo.used_count + 1 >= promo.max_uses) {
      db.prepare('UPDATE promotions SET active = 0 WHERE id = ?').run(promo.id);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Apply promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, (req, res) => {
  try {
    const { active, code, discount_type, discount_value, max_uses, expires_at, min_purchase } = req.body;
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Promotion not found' });

    db.prepare(`
      UPDATE promotions SET
        code = ?, discount_type = ?, discount_value = ?, max_uses = ?,
        expires_at = ?, min_purchase = ?, active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      code?.toUpperCase() ?? existing.code,
      discount_type ?? existing.discount_type,
      discount_value ?? existing.discount_value,
      max_uses ?? existing.max_uses,
      expires_at !== undefined ? expires_at : existing.expires_at,
      min_purchase !== undefined ? min_purchase : existing.min_purchase,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      req.params.id
    );

    const promo = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    res.json({ promotion: promo });
  } catch (err) {
    logger.error('Update promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Promotion not found' });
    db.prepare('DELETE FROM promotions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete promotion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
