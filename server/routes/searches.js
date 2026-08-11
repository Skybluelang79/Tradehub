import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import logger from '../src/logger.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const searches = db.prepare(
      'SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC'
    ).all(req.user.id);
    res.json({ searches });
  } catch (err) {
    logger.error('List saved searches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { name, query = '', category = '', min_price, max_price } = req.body || {};
    const cleanName = String(name || query || 'Untitled search').trim();
    if (!cleanName) return res.status(400).json({ error: 'Search name is required' });

    const count = db.prepare('SELECT COUNT(*) c FROM saved_searches WHERE user_id = ?').get(req.user.id);
    if (count.c >= 50) return res.status(400).json({ error: 'Maximum of 50 saved searches reached' });

    const id = uuidv4();
    db.prepare(
      `INSERT INTO saved_searches (id, user_id, name, query, category, min_price, max_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user.id,
      cleanName.slice(0, 120),
      String(query).slice(0, 120),
      String(category).slice(0, 50),
      min_price !== undefined && min_price !== null && min_price !== '' ? Number(min_price) : null,
      max_price !== undefined && max_price !== null && max_price !== '' ? Number(max_price) : null
    );
    res.json({ search: db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id) });
  } catch (err) {
    logger.error('Create saved search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM saved_searches WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Saved search not found' });

    const { name, query = '', category = '', min_price, max_price } = req.body || {};
    db.prepare(
      `UPDATE saved_searches SET name = ?, query = ?, category = ?, min_price = ?, max_price = ? WHERE id = ?`
    ).run(
      String(name || query || 'Untitled search').trim().slice(0, 120),
      String(query).slice(0, 120),
      String(category).slice(0, 50),
      min_price !== undefined && min_price !== null && min_price !== '' ? Number(min_price) : null,
      max_price !== undefined && max_price !== null && max_price !== '' ? Number(max_price) : null,
      existing.id
    );
    res.json({ search: db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(existing.id) });
  } catch (err) {
    logger.error('Update saved search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    logger.error('Delete saved search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
