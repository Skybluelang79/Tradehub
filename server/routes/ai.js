import { Router } from 'express';
import db from '../db.js';
import logger from '../src/logger.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import {
  generateListing,
  parseSearch,
  answerListingQuestion,
  priceGuide,
  recommendations,
} from '../src/ai.js';

const router = Router();

router.post('/listing', authenticateToken, async (req, res) => {
  try {
    const { title = '', description = '', category = '', condition = '', imageHints = '' } = req.body || {};
    if (!String(title).trim() && !category) {
      return res.status(400).json({ error: 'Enter a title or category first' });
    }
    const result = await generateListing({ title, description, category, condition, imageHints });
    res.json(result);
  } catch (err) {
    logger.error('AI listing generation error:', err);
    res.status(500).json({ error: 'AI listing generation failed' });
  }
});

router.post('/parse', async (req, res) => {
  try {
    const { query = '' } = req.body || {};
    if (!String(query).trim()) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    const result = await parseSearch(query);
    res.json(result);
  } catch (err) {
    logger.error('AI search parse error:', err);
    res.status(500).json({ error: 'AI search failed' });
  }
});

router.post('/question', optionalAuth, async (req, res) => {
  try {
    const { itemId, question = '' } = req.body || {};
    if (!itemId) return res.status(400).json({ error: 'itemId is required' });
    if (!String(question).trim()) return res.status(400).json({ error: 'Question is required' });

    const row = db.prepare(
      `SELECT i.*, u.name AS seller_name
       FROM items i LEFT JOIN users u ON u.id = i.seller_id
       WHERE i.id = ?`
    ).get(itemId);
    if (!row) return res.status(404).json({ error: 'Item not found' });

    const answer = await answerListingQuestion({ item: row, sellerName: row.seller_name || '', question });
    res.json({ answer });
  } catch (err) {
    logger.error('AI question error:', err);
    res.status(500).json({ error: 'AI question failed' });
  }
});

router.post('/price-guide', optionalAuth, async (req, res) => {
  try {
    const { itemId, category, price, title } = req.body || {};
    if (itemId) {
      const row = db.prepare('SELECT id, title, price, category FROM items WHERE id = ?').get(itemId);
      if (!row) return res.status(404).json({ error: 'Item not found' });
      res.json(priceGuide({ category: row.category, price: Number(row.price), title: row.title, excludeId: row.id }));
      return;
    }
    res.json(priceGuide({ category, price, title }));
  } catch (err) {
    logger.error('AI price guide error:', err);
    res.status(500).json({ error: 'AI price guide failed' });
  }
});

router.get('/recommendations', optionalAuth, async (req, res) => {
  try {
    const itemId = String(req.query.itemId || '');
    const limit = req.query.limit;
    const result = await recommendations({ userId: req.user?.id || '', itemId, limit });
    res.json({ items: result });
  } catch (err) {
    logger.error('AI recommendations error:', err);
    res.status(500).json({ error: 'AI recommendations failed' });
  }
});

export default router;