import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import validate, { createReviewSchema } from '../src/validation.js';
import logger from '../src/logger.js';

const router = Router();

router.get('/user/:userId', (req, res) => {
  try {
    const reviews = db.prepare(`
      SELECT r.*, u.name as reviewer_name, u.avatar as reviewer_avatar
      FROM reviews r JOIN users u ON r.reviewer_id = u.id
      WHERE r.reviewee_id = ?
      ORDER BY r.created_at DESC
    `).all(req.params.userId);

    res.json({ reviews });
  } catch (err) {
    logger.error('Get reviews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, validate(createReviewSchema), (req, res) => {
  try {
    const { revieweeId, itemId, rating, text } = req.validatedBody;

    if (!revieweeId || !rating) {
      return res.status(400).json({ error: 'revieweeId and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    if (revieweeId === req.user.id) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    // Reviews must follow a completed transaction so users can't farm reviews
    // on accounts they've never actually traded with.
    const completedTxn = db.prepare(`
      SELECT id, item_id FROM transactions
      WHERE status = 'completed'
        AND ((buyer_id = ? AND seller_id = ?) OR (buyer_id = ? AND seller_id = ?))
    `).get(req.user.id, revieweeId, revieweeId, req.user.id);
    if (!completedTxn) {
      return res.status(403).json({ error: 'You can only review a user after a completed transaction' });
    }

    // Only mark the review "verified" when it's tied to an actual purchase of
    // that specific item, not merely asserted by the reviewer.
    let verified = 0;
    if (itemId) {
      const itemTxn = db.prepare(`
        SELECT id FROM transactions
        WHERE status = 'completed' AND item_id = ? AND buyer_id = ? AND seller_id = ?
      `).get(itemId, req.user.id, revieweeId);
      verified = itemTxn ? 1 : 0;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO reviews (id, reviewer_id, reviewee_id, item_id, rating, text, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, revieweeId, itemId || null, rating, text || '', verified);

    const reviews = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE reviewee_id = ?').get(revieweeId);
    db.prepare('UPDATE users SET rating = ?, review_count = ? WHERE id = ?').run(
      Math.round(reviews.avg * 10) / 10, reviews.count, revieweeId
    );

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'review', 'New Review', ?)
    `).run(uuidv4(), revieweeId, `${req.user.name} left you a ${rating}-star review.`);

    const review = db.prepare(`
      SELECT r.*, u.name as reviewer_name, u.avatar as reviewer_avatar
      FROM reviews r JOIN users u ON r.reviewer_id = u.id WHERE r.id = ?
    `).get(id);

    res.status(201).json({ review });
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
