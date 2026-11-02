import { Router } from 'express';
import db from '../db.js';
import { optionalAuth } from '../middleware/auth.js';
import logger from '../src/logger.js';

const router = Router();

router.get('/:slug', optionalAuth, (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) return res.status(404).json({ error: 'Store not found' });

    const user = db.prepare(`
      SELECT id, name, avatar, bio, verified, identity_verified, rating, review_count,
        location_address, created_at, store_slug, store_banner, store_description
      FROM users
      WHERE store_slug = ? AND COALESCE(status, 'active') NOT IN ('banned', 'suspended')
    `).get(slug);
    if (!user) return res.status(404).json({ error: 'Store not found' });

    const listings = db.prepare(`
      SELECT id, title, description, price, sale_price, condition, status, views, favorites, created_at
      FROM items WHERE seller_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 60
    `).all(user.id);
    listings.forEach((item) => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').all(item.id);
      item.images = images.map((img) => img.url);
    });

    const stats = db.prepare(`
      SELECT COUNT(*) as total_listings,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_listings,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_listings
      FROM items WHERE seller_id = ?
    `).get(user.id);

    const followerCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(user.id).count;
    const followingCount = db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').get(user.id).count;
    const isFollowing = req.user
      ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, user.id)
      : false;

    res.json({
      user,
      listings,
      stats: {
        total_listings: stats?.total_listings || 0,
        active_listings: stats?.active_listings || 0,
        sold_listings: stats?.sold_listings || 0,
      },
      followerCount,
      followingCount,
      isFollowing,
    });
  } catch (err) {
    logger.error('Store lookup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
