import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import { sendNotificationEmail } from '../src/email.js';
import logger from '../src/logger.js';

const router = Router();

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

function getUserById(id) {
  return db.prepare('SELECT id, name, email, avatar, bio, verified, rating, review_count, created_at FROM users WHERE id = ?').get(id);
}

function followerCount(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM follows WHERE following_id = ?').get(userId).count;
}

function followingCount(userId) {
  return db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ?').get(userId).count;
}

router.post('/:userId/follow', authenticateToken, (req, res) => {
  try {
    const targetId = req.params.userId;
    if (targetId === req.user.id) return res.status(400).json({ error: 'You cannot follow yourself' });
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)').run(req.user.id, targetId);

    const existing = db.prepare('SELECT COUNT(*) as count FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, targetId).count;
    if (existing) {
      const targetUser = getUserById(targetId);
      if (targetUser?.email) {
        sendNotificationEmail(targetUser.email, `${req.user.name} is now following you`, `${req.user.name} started following you on TradeHub.`).catch(() => {});
      }
    }
    notify(targetId, 'follow', 'New Follower', `${req.user.name} started following you.`);

    res.json({ success: true, followerCount: followerCount(targetId), isFollowing: true });
  } catch (err) {
    logger.error('Follow error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:userId/follow', authenticateToken, (req, res) => {
  try {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(req.user.id, req.params.userId);
    res.json({ success: true, followerCount: followerCount(req.params.userId), isFollowing: false });
  } catch (err) {
    logger.error('Unfollow error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status/:userId', authenticateToken, (req, res) => {
  try {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const isFollowing = !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.userId);
    res.json({ isFollowing, followerCount: followerCount(req.params.userId), followingCount: followingCount(req.params.userId) });
  } catch (err) {
    logger.error('Follow status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/counts/:userId', (req, res) => {
  try {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    res.json({ followerCount: followerCount(req.params.userId), followingCount: followingCount(req.params.userId) });
  } catch (err) {
    logger.error('Follow counts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/following', authenticateToken, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT f.following_id as id, u.name, u.avatar, u.bio, u.verified, u.rating, u.review_count, f.created_at as followed_at
      FROM follows f JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = ? ORDER BY f.created_at DESC
    `).all(req.user.id);
    rows.forEach((row) => {
      row.follower_count = followerCount(row.id);
      row.following_count = followingCount(row.id);
    });
    res.json({ following: rows });
  } catch (err) {
    logger.error('List following error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/followers', authenticateToken, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT f.follower_id as id, u.name, u.avatar, u.bio, u.verified, u.rating, u.review_count, f.created_at as followed_at
      FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = ? ORDER BY f.created_at DESC
    `).all(req.user.id);
    rows.forEach((row) => {
      row.follower_count = followerCount(row.id);
      row.following_count = followingCount(row.id);
    });
    res.json({ followers: rows });
  } catch (err) {
    logger.error('List followers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/storefront/:userId', optionalAuth, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, avatar, bio, phone, verified, rating, review_count, location_address, created_at FROM users WHERE id = ?').get(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const listings = db.prepare(`
      SELECT id, title, description, price, sale_price, condition, status, views, favorites, created_at
      FROM items WHERE seller_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 60
    `).all(req.params.userId);
    listings.forEach((item) => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').all(item.id);
      item.images = images.map((img) => img.url);
    });

    const stats = db.prepare(`
      SELECT COUNT(*) as total_listings,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_listings,
        SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_listings
      FROM items WHERE seller_id = ?
    `).get(req.params.userId);

    const isFollowing = req.user
      ? !!db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.userId)
      : false;

    res.json({
      user,
      listings,
      stats: {
        total_listings: stats?.total_listings || 0,
        active_listings: stats?.active_listings || 0,
        sold_listings: stats?.sold_listings || 0,
      },
      followerCount: followerCount(req.params.userId),
      followingCount: followingCount(req.params.userId),
      isFollowing,
    });
  } catch (err) {
    logger.error('Storefront error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
