import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

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
    console.error('Get reviews error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { revieweeId, itemId, rating, text } = req.body;

    if (!revieweeId || !rating) {
      return res.status(400).json({ error: 'revieweeId and rating are required' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    if (revieweeId === req.user.id) {
      return res.status(400).json({ error: 'Cannot review yourself' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO reviews (id, reviewer_id, reviewee_id, item_id, rating, text, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, revieweeId, itemId || null, rating, text || '', itemId ? 1 : 0);

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
