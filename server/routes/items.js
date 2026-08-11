import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';
import validate, { createItemSchema, updateItemSchema, placeBidSchema } from '../src/validation.js';
import logger from '../src/logger.js';

const router = Router();

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get('/', optionalAuth, (req, res) => {
  try {
    const {
      category, sort = 'newest', search, max_distance,
      min_price, max_price, condition: itemCondition,
      page = 1, limit = 20, seller_id,
    } = req.query;

    let query = `
      SELECT i.*, u.name as seller_name, u.avatar as seller_avatar,
             u.rating as seller_rating, u.verified as seller_verified,
             COALESCE(s.plan, 'free') as seller_plan
      FROM items i
      JOIN users u ON i.seller_id = u.id
      LEFT JOIN subscriptions s ON s.user_id = u.id
      WHERE i.status = 'active'
    `;
    const params = [];

    if (search) {
      query += ' AND (i.title LIKE ? OR i.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category && category !== 'all') {
      query += ' AND LOWER(i.category) = LOWER(?)';
      params.push(category);
    }

    if (seller_id) {
      query += ' AND i.seller_id = ?';
      params.push(seller_id);
    }

    if (min_price) {
      query += ' AND i.price >= ?';
      params.push(parseFloat(min_price));
    }

    if (max_price) {
      query += ' AND i.price <= ?';
      params.push(parseFloat(max_price));
    }

    if (itemCondition) {
      query += ' AND LOWER(i.condition) = LOWER(?)';
      params.push(itemCondition);
    }

    switch (sort) {
      case 'newest': query += ' ORDER BY i.created_at DESC'; break;
      case 'oldest': query += ' ORDER BY i.created_at ASC'; break;
      case 'price_low': query += ' ORDER BY i.price ASC'; break;
      case 'price_high': query += ' ORDER BY i.price DESC'; break;
      case 'popular': query += ' ORDER BY i.views DESC, i.favorites DESC'; break;
      case 'nearest':
        if (req.user && req.user.location_lat && req.user.location_lng) {
          query = query.replace('SELECT i.*', `SELECT i.*, (
            6371 * 2 * ASIN(SQRT(
              POWER(SIN((? - i.location_lat) * PI() / 360), 2) +
              COS(? * PI() / 180) * COS(i.location_lat * PI() / 180) *
              POWER(SIN((? - i.location_lng) * PI() / 360), 2)
            ))
          ) as distance`);
          params.push(req.user.location_lat, req.user.location_lat, req.user.location_lng);
          query += ' ORDER BY distance ASC';
        } else {
          query += ' ORDER BY i.created_at DESC';
        }
        break;
      default: query += ' ORDER BY i.boosted DESC, i.created_at DESC';
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ' LIMIT ? OFFSET ?';
    params.push(parseInt(limit), offset);

    const items = db.prepare(query).all(...params);

    const enriched = items.map(item => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(item.id);
      item.images = images.map(i => i.url);

      if (req.user && item.location_lat && item.location_lng) {
        item.distance = calculateDistance(
          req.user.location_lat, req.user.location_lng,
          item.location_lat, item.location_lng
        );
      }

      const isFav = req.user
        ? db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id)
        : false;
      item.is_favorite = !!isFav;
      item.sale_active = item.sale_price && (!item.sale_ends_at || new Date(item.sale_ends_at) > new Date());

      return item;
    });

    if (max_distance && req.user) {
      const filtered = enriched.filter(i => i.distance && i.distance <= parseFloat(max_distance));
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      return res.json({
        items: filtered.slice(offset, offset + limitNum),
        total: filtered.length,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(filtered.length / limitNum),
      });
    }

    const total = db.prepare('SELECT COUNT(*) as count FROM items WHERE status = ?').get('active');
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    res.json({
      items: enriched,
      total: total.count,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total.count / limitNum),
    });
  } catch (err) {
    logger.error('Get items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/user/:userId/drafts', authenticateToken, (req, res) => {
  try {
    if (req.user.id !== req.params.userId) return res.status(403).json({ error: 'Not authorized' });
    const items = db.prepare('SELECT * FROM items WHERE seller_id = ? AND status = ? ORDER BY updated_at DESC').all(req.params.userId, 'draft');
    items.forEach(item => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(item.id);
      item.images = images.map(i => i.url);
    });
    res.json({ items });
  } catch (err) {
    logger.error('Get drafts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/user/:userId', (req, res) => {
  try {
    const items = db.prepare(`
      SELECT i.*, u.name as seller_name, u.avatar as seller_avatar
      FROM items i JOIN users u ON i.seller_id = u.id
      WHERE i.seller_id = ? AND i.status != 'draft'
      ORDER BY i.created_at DESC
    `).all(req.params.userId);
    items.forEach(item => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(item.id);
      item.images = images.map(i => i.url);
    });
    res.json({ items });
  } catch (err) {
    logger.error('Get user items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/categories/overview', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT category, COUNT(*) as count, AVG(price) as avg_price
      FROM items WHERE status = 'active'
      GROUP BY category ORDER BY count DESC
    `).all();
    res.json({ categories });
  } catch (err) {
    logger.error('Get categories error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', optionalAuth, (req, res) => {
  try {
    const item = db.prepare(`
      SELECT i.*, u.name as seller_name, u.avatar as seller_avatar, u.rating as seller_rating,
             u.review_count as seller_review_count, u.verified as seller_verified, u.bio as seller_bio,
             u.created_at as seller_joined
      FROM items i JOIN users u ON i.seller_id = u.id
      WHERE i.id = ?
    `).get(req.params.id);

    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(item.id);
    item.images = images.map(i => i.url);

    const variants = db.prepare('SELECT name, variant_values FROM item_variants WHERE item_id = ?').all(item.id);
    item.variants = variants.map(v => ({ name: v.name, values: JSON.parse(v.variant_values) }));

    db.prepare('UPDATE items SET views = views + 1 WHERE id = ?').run(item.id);

    if (req.user && item.location_lat && item.location_lng) {
      item.distance = calculateDistance(req.user.location_lat, req.user.location_lng, item.location_lat, item.location_lng);
    }

    const isFav = req.user ? db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id) : false;
    item.is_favorite = !!isFav;
    item.sale_active = item.sale_price && (!item.sale_ends_at || new Date(item.sale_ends_at) > new Date());

    const similar = db.prepare(`
      SELECT i.id, i.title, i.price, i.sale_price,
        (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) as image
      FROM items i WHERE i.category = ? AND i.id != ? AND i.status = 'active'
      ORDER BY i.created_at DESC LIMIT 6
    `).all(item.category, item.id);
    item.similar_items = similar;

    res.json({ item });
  } catch (err) {
    logger.error('Get item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, validate(createItemSchema), (req, res) => {
  try {
    const {
      title, description, price, sale_price, sale_ends_at,
      category, condition, images, location, quantity,
      variants, boosted, boost_expires_at,
      is_auction, starting_bid, min_increment, auction_ends_at,
    } = req.validatedBody;

    const id = uuidv4();
    const auction = is_auction === true;

    db.prepare(`
      INSERT INTO items (id, title, description, price, sale_price, sale_ends_at, category, condition, seller_id, location_lat, location_lng, location_address, quantity, boosted, boost_expires_at, is_auction, starting_bid, min_increment, auction_ends_at, auction_status, current_bid, current_bidder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, description, price,
      sale_price || null, sale_ends_at || null,
      category, condition, req.user.id,
      location?.lat || null, location?.lng || null,
      location?.address || '', quantity || 1,
      boosted ? 1 : 0, boost_expires_at || null,
      auction ? 1 : 0,
      auction ? (starting_bid ?? price) : null,
      auction ? (min_increment || 1) : null,
      auction ? (auction_ends_at || null) : null,
      auction ? 'active' : 'pending',
      auction ? (starting_bid ?? price) : null,
      null
    );

    if (images && images.length > 0) {
      const insertImg = db.prepare('INSERT INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)');
      images.forEach((url, i) => insertImg.run(uuidv4(), id, url, i));
    }

    if (variants && variants.length > 0) {
      const insertVar = db.prepare('INSERT INTO item_variants (id, item_id, name, variant_values) VALUES (?, ?, ?, ?)');
      variants.forEach(v => insertVar.run(uuidv4(), id, v.name, JSON.stringify(v.values)));
    }

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    const itemImages = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(id);
    item.images = itemImages.map(i => i.url);

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'system', 'Listing Created', ?)
    `).run(uuidv4(), req.user.id, `"${title}" is now live!`);

    db.prepare(`
      INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), null, 'item_created', 'item', id, JSON.stringify({ title }));

    res.status(201).json({ item });
  } catch (err) {
    logger.error('Create item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, validate(updateItemSchema), (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const data = req.validatedBody;

    db.prepare(`
      UPDATE items SET title = ?, description = ?, price = ?, sale_price = ?, sale_ends_at = ?,
        category = ?, condition = ?, location_lat = ?, location_lng = ?, location_address = ?,
        quantity = ?, status = ?, boosted = ?, boost_expires_at = ?, updated_at = datetime('now'),
        is_auction = ?, starting_bid = ?, min_increment = ?, auction_ends_at = ?, auction_status = ?
      WHERE id = ?
    `).run(
      data.title ?? item.title, data.description ?? item.description,
      data.price ?? item.price,
      data.sale_price !== undefined ? (data.sale_price || null) : item.sale_price,
      data.sale_ends_at !== undefined ? data.sale_ends_at : item.sale_ends_at,
      data.category ?? item.category, data.condition ?? item.condition,
      data.location?.lat ?? item.location_lat, data.location?.lng ?? item.location_lng,
      data.location?.address ?? item.location_address,
      data.quantity ?? item.quantity, data.status ?? item.status,
      data.boosted !== undefined ? (data.boosted ? 1 : 0) : item.boosted,
      data.boost_expires_at ?? item.boost_expires_at,
      data.is_auction !== undefined ? (data.is_auction ? 1 : 0) : item.is_auction,
      data.starting_bid !== undefined ? data.starting_bid : item.starting_bid,
      data.min_increment !== undefined ? (data.min_increment || 1) : item.min_increment,
      data.auction_ends_at !== undefined ? data.auction_ends_at : item.auction_ends_at,
      data.auction_status ?? item.auction_status,
      req.params.id
    );

    if (data.images) {
      db.prepare('DELETE FROM item_images WHERE item_id = ?').run(req.params.id);
      const insertImg = db.prepare('INSERT INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)');
      data.images.forEach((url, i) => insertImg.run(uuidv4(), req.params.id, url, i));
    }

    if (data.variants) {
      db.prepare('DELETE FROM item_variants WHERE item_id = ?').run(req.params.id);
      const insertVar = db.prepare('INSERT INTO item_variants (id, item_id, name, variant_values) VALUES (?, ?, ?, ?)');
      data.variants.forEach(v => insertVar.run(uuidv4(), req.params.id, v.name, JSON.stringify(v.values)));
    }

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    const itemImages = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(req.params.id);
    updated.images = itemImages.map(i => i.url);

    res.json({ item: updated });
  } catch (err) {
    logger.error('Update item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);

    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body)
      VALUES (?, ?, 'system', 'Listing Deleted', ?)
    `).run(uuidv4(), req.user.id, `"${item.title}" has been removed.`);

    res.json({ success: true });
  } catch (err) {
    logger.error('Delete item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/bulk/update', authenticateToken, (req, res) => {
  try {
    const { ids, updates } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids is required' });
    if (ids.length > 50) return res.status(400).json({ error: 'Maximum of 50 items per bulk operation' });
    if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'updates is required' });

    const placeholders = ids.map(() => '?').join(',');
    const owned = db.prepare(
      `SELECT id, title, status FROM items WHERE id IN (${placeholders}) AND seller_id = ?`
    ).all(...ids, req.user.id);
    if (owned.length === 0) return res.status(403).json({ error: 'Not authorized' });

    const allowed = ['price', 'sale_price', 'category', 'condition', 'quantity', 'status'];
    const changes = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) changes[key] = updates[key];
    }
    if (Object.keys(changes).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    const vals = Object.keys(changes).map((k) => changes[k] ?? null);
    const run = db.prepare(`UPDATE items SET ${sets}, updated_at = datetime('now') WHERE id = ?`);

    for (const item of owned) run.run(...vals, item.id);

    res.json({ success: true, updated: owned.length, items: owned });
  } catch (err) {
    logger.error('Bulk update items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bulk/delete', authenticateToken, (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids is required' });
    if (ids.length > 50) return res.status(400).json({ error: 'Maximum of 50 items per bulk operation' });

    const placeholders = ids.map(() => '?').join(',');
    const owned = db.prepare(
      `SELECT id, title FROM items WHERE id IN (${placeholders}) AND seller_id = ?`
    ).all(...ids, req.user.id);
    if (owned.length === 0) return res.status(403).json({ error: 'Not authorized' });

    db.prepare(`DELETE FROM items WHERE id IN (${placeholders}) AND seller_id = ?`).run(...ids, req.user.id);

    const insertNotif = db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, 'system', 'Listing Deleted', ?)`
    );
    for (const item of owned) {
      insertNotif.run(uuidv4(), req.user.id, `"${item.title}" has been removed.`);
    }

    res.json({ success: true, deleted: owned.length });
  } catch (err) {
    logger.error('Bulk delete items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


router.post('/:id/favorite', authenticateToken, (req, res) => {
  try {
    const item = db.prepare('SELECT id, price, sale_price FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, req.params.id);

    if (existing) {
      db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(req.user.id, req.params.id);
      db.prepare('UPDATE items SET favorites = MAX(0, favorites - 1) WHERE id = ?').run(req.params.id);
      res.json({ favorited: false });
    } else {
      const priceAtAdd = item.sale_price ?? item.price;
      db.prepare('INSERT INTO favorites (user_id, item_id, price_at_add) VALUES (?, ?, ?)').run(req.user.id, req.params.id, priceAtAdd);
      db.prepare('UPDATE items SET favorites = favorites + 1 WHERE id = ?').run(req.params.id);
      res.json({ favorited: true });
    }
  } catch (err) {
    logger.error('Favorite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/bids', (req, res) => {
  try {
    const item = db.prepare('SELECT id, is_auction FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!item.is_auction) return res.status(400).json({ error: 'Item is not an auction' });

    const bids = db.prepare(`
      SELECT b.id, b.amount, b.created_at, u.name as bidder_name, u.avatar as bidder_avatar
      FROM bids b JOIN users u ON b.bidder_id = u.id
      WHERE b.item_id = ? ORDER BY b.amount DESC LIMIT 50
    `).all(req.params.id);
    res.json({ bids });
  } catch (err) {
    logger.error('Get bids error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/bid', authenticateToken, validate(placeBidSchema), (req, res) => {
  try {
    const item = db.prepare(
      'SELECT id, seller_id, is_auction, starting_bid, min_increment, current_bid, current_bidder_id, auction_ends_at, auction_status, status FROM items WHERE id = ?'
    ).get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (!item.is_auction) return res.status(400).json({ error: 'Item is not an auction' });
    if (item.status !== 'active' || item.auction_status !== 'active') return res.status(400).json({ error: 'Auction is not accepting bids' });
    if (item.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot bid on your own auction' });
    if (item.auction_ends_at && new Date(item.auction_ends_at) <= new Date()) return res.status(400).json({ error: 'Auction has ended' });

    const amount = req.validatedBody.amount;
    const currentBid = item.current_bid ?? item.starting_bid ?? 0;
    const minBid = currentBid + (item.min_increment || 1);
    if (amount < minBid) {
      return res.status(400).json({ error: `Bid must be at least $${minBid.toFixed(2)}` });
    }

    const id = uuidv4();
    db.prepare('INSERT INTO bids (id, item_id, bidder_id, amount) VALUES (?, ?, ?, ?)').run(id, item.id, req.user.id, amount);
    db.prepare('UPDATE items SET current_bid = ?, current_bidder_id = ? WHERE id = ?').run(amount, req.user.id, item.id);

    if (item.current_bidder_id && item.current_bidder_id !== req.user.id) {
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, data)
        VALUES (?, ?, 'system', "You've been outbid", ?, ?)
      `).run(uuidv4(), item.current_bidder_id, `A new bid of $${amount.toFixed(2)} was placed on your auction item.`, JSON.stringify({ itemId: item.id }));
    }

    res.status(201).json({
      bid: db.prepare('SELECT * FROM bids WHERE id = ?').get(id),
      current_bid: amount,
    });
  } catch (err) {
    logger.error('Place bid error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/related', (req, res) => {
  try {
    const item = db.prepare('SELECT category, id FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const related = db.prepare(`
      SELECT i.id, i.title, i.price, i.sale_price, i.created_at,
        (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) as image
      FROM items i WHERE i.category = ? AND i.id != ? AND i.status = 'active'
      ORDER BY i.created_at DESC LIMIT 8
    `).all(item.category, item.id);

    res.json({ items: related });
  } catch (err) {
    logger.error('Related items error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/mark-sold', authenticateToken, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    db.prepare("UPDATE items SET status = 'sold', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ success: true, status: 'sold' });
  } catch (err) {
    logger.error('Mark item sold error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/relist', authenticateToken, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (item.status !== 'sold') return res.status(400).json({ error: 'Only sold items can be relisted' });

    db.prepare("UPDATE items SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ success: true, status: 'active' });
  } catch (err) {
    logger.error('Relist item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/premium/sellers', (req, res) => {
  try {
    const sellers = db.prepare(`
      SELECT u.id, u.name, u.avatar, u.rating, u.review_count, u.verified,
             s.plan, s.status
      FROM users u
      JOIN subscriptions s ON s.user_id = u.id
      WHERE s.plan IN ('premium', 'pro') AND s.status = 'active'
      ORDER BY u.rating DESC LIMIT 10
    `).all();

    const enriched = sellers.map(seller => {
      const items = db.prepare(`
        SELECT i.id, i.title, i.price, i.sale_price,
          (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) as image
        FROM items i WHERE i.seller_id = ? AND i.status = 'active'
        ORDER BY i.created_at DESC LIMIT 3
      `).all(seller.id);

      return {
        ...seller,
        badge: seller.plan === 'pro' ? 'Pro Seller' : 'Premium Seller',
        items,
      };
    });

    res.json({ sellers: enriched });
  } catch (err) {
    logger.error('Premium sellers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
