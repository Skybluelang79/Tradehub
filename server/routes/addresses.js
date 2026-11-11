import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import validate, { createAddressSchema, updateAddressSchema } from '../src/validation.js';
import logger from '../src/logger.js';

const router = Router();
const MAX_ADDRESSES = 20;
const ADDRESS_FIELDS = [
  'label',
  'full_name',
  'phone',
  'line1',
  'line2',
  'city',
  'region',
  'postal_code',
  'country',
];

function normalizeAddress(row) {
  if (!row) return null;
  return { ...row, is_default: !!row.is_default };
}

function cleanAddress(data) {
  const next = { ...data };
  if (typeof next.country === 'string' && next.country.length === 2) {
    next.country = next.country.toUpperCase();
  }
  return next;
}

function findOwned(id, userId) {
  return db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(id, userId);
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const addresses = db.prepare(
      'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'
    ).all(req.user.id).map(normalizeAddress);
    res.json({ addresses });
  } catch (err) {
    logger.error('List addresses error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    const address = findOwned(req.params.id, req.user.id);
    if (!address) return res.status(404).json({ error: 'Address not found' });
    res.json({ address: normalizeAddress(address) });
  } catch (err) {
    logger.error('Get address error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, validate(createAddressSchema), (req, res) => {
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM addresses WHERE user_id = ?')
      .get(req.user.id).count;
    if (count >= MAX_ADDRESSES) {
      return res.status(400).json({ error: `Maximum of ${MAX_ADDRESSES} addresses reached` });
    }

    const data = cleanAddress(req.validatedBody);
    const isDefault = data.is_default === true || count === 0;
    const id = uuidv4();

    db.prepare(`
      INSERT INTO addresses
        (id, user_id, label, full_name, phone, line1, line2, city, region, postal_code, country, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.user.id,
      data.label,
      data.full_name,
      data.phone,
      data.line1,
      data.line2,
      data.city,
      data.region,
      data.postal_code,
      data.country,
      isDefault ? 1 : 0
    );
    if (isDefault) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id != ?')
        .run(req.user.id, id);
    }

    res.status(201).json({ address: normalizeAddress(findOwned(id, req.user.id)) });
  } catch (err) {
    logger.error('Create address error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, validate(updateAddressSchema), (req, res) => {
  try {
    const existing = findOwned(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Address not found' });

    const data = cleanAddress(req.validatedBody);
    const updates = [];
    const params = [];
    for (const field of ADDRESS_FIELDS) {
      if (data[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(data[field]);
      }
    }

    if (data.is_default === true) updates.push('is_default = 1');
    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      db.prepare(`UPDATE addresses SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
        .run(...params, req.params.id, req.user.id);
    }
    if (data.is_default === true) {
      db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id != ?')
        .run(req.user.id, req.params.id);
    }

    res.json({ address: normalizeAddress(findOwned(req.params.id, req.user.id)) });
  } catch (err) {
    logger.error('Update address error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/default', authenticateToken, (req, res) => {
  try {
    const existing = findOwned(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Address not found' });

    db.prepare("UPDATE addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(req.params.id, req.user.id);
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id != ?')
      .run(req.user.id, req.params.id);

    res.json({ address: normalizeAddress(findOwned(req.params.id, req.user.id)) });
  } catch (err) {
    logger.error('Set default address error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const existing = findOwned(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Address not found' });

    db.prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (existing.is_default) {
      const next = db.prepare(
        'SELECT id FROM addresses WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1'
      ).get(req.user.id);
      if (next) {
        db.prepare("UPDATE addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ?")
          .run(next.id);
      }
    }

    res.json({ success: true });
  } catch (err) {
    logger.error('Delete address error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
