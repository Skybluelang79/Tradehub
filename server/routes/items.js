import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.js';

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
    const { category, sort = 'newest', search, max_distance, page = 1, limit = 20 } = req.query;
    let query = `
      SELECT i.*, u.name as seller_name, u.avatar as seller_avatar, u.rating as seller_rating, u.verified as seller_verified
      FROM items i
      JOIN users u ON i.seller_id = u.id
      WHERE i.status = 'active'
    `;
    const params = [];

    if (category && category !== 'all') {
      query += ' AND LOWER(i.category) = LOWER(?)';
      params.push(category);
    }

    if (search) {
      query += ' AND (i.title LIKE ? OR i.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    switch (sort) {
      case 'newest': query += ' ORDER BY i.created_at DESC'; break;
      case 'oldest': query += ' ORDER BY i.created_at ASC'; break;
      case 'price_low': query += ' ORDER BY i.price ASC'; break;
      case 'price_high': query += ' ORDER BY i.price DESC'; break;
      default: query += ' ORDER BY i.boosted DESC, i.created_at DESC';
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), offset);

    const items = db.prepare(query).all(...params);

    const enriched = items.map(item => {
      const images = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(item.id);
      item.images = images.map(i => i.url);

      if (req.user && item.location_lat && item.location_lng) {
        item.distance = calculateDistance(req.user.location_lat, req.user.location_lng, item.location_lat, item.location_lng);
      }

      const isFav = req.user ? db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, item.id) : false;
      item.is_favorite = !!isFav;

      return item;
    });

    if (max_distance && req.user) {
      const filtered = enriched.filter(i => i.distance && i.distance <= parseFloat(max_distance));
      res.json({ items: filtered, total: filtered.length });
    } else {
      const total = db.prepare('SELECT COUNT(*) as count FROM items WHERE status = ?').get('active');
      res.json({ items: enriched, total: total.count });
    }
  } catch (err) {
    console.error('Get items error:', err);
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
    console.error('Get drafts error:', err);
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
    console.error('Get user items error:', err);
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

    res.json({ item });
  } catch (err) {
    console.error('Get item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { title, description, price, sale_price, sale_ends_at, category, condition, images, location, quantity, variants, boosted, boost_expires_at } = req.body;

    if (!title || !price || !category) {
      return res.status(400).json({ error: 'Title, price, and category are required' });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO items (id, title, description, price, sale_price, sale_ends_at, category, condition, seller_id, location_lat, location_lng, location_address, quantity, boosted, boost_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, title, description || '', parseFloat(price),
      sale_price ? parseFloat(sale_price) : null,
      sale_ends_at || null,
      category, condition || 'good', req.user.id,
      location?.lat || null, location?.lng || null,
      location?.address || '', quantity || 1,
      boosted ? 1 : 0, boost_expires_at || null
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

    res.status(201).json({ item });
  } catch (err) {
    console.error('Create item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticateToken, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id !== req.user.id) return res.status(403).json({ error: 'Not authorized' });

    const { title, description, price, sale_price, sale_ends_at, category, condition, images, location, quantity, variants, status, boosted, boost_expires_at } = req.body;

    db.prepare(`
      UPDATE items SET title = ?, description = ?, price = ?, sale_price = ?, sale_ends_at = ?,
        category = ?, condition = ?, location_lat = ?, location_lng = ?, location_address = ?,
        quantity = ?, status = ?, boosted = ?, boost_expires_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title ?? item.title, description ?? item.description,
      price ? parseFloat(price) : item.price,
      sale_price !== undefined ? (sale_price ? parseFloat(sale_price) : null) : item.sale_price,
      sale_ends_at !== undefined ? sale_ends_at : item.sale_ends_at,
      category ?? item.category, condition ?? item.condition,
      location?.lat ?? item.location_lat, location?.lng ?? item.location_lng,
      location?.address ?? item.location_address,
      quantity ?? item.quantity, status ?? item.status,
      boosted !== undefined ? (boosted ? 1 : 0) : item.boosted,
      boost_expires_at ?? item.boost_expires_at,
      req.params.id
    );

    if (images) {
      db.prepare('DELETE FROM item_images WHERE item_id = ?').run(req.params.id);
      const insertImg = db.prepare('INSERT INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)');
      images.forEach((url, i) => insertImg.run(uuidv4(), req.params.id, url, i));
    }

    if (variants) {
      db.prepare('DELETE FROM item_variants WHERE item_id = ?').run(req.params.id);
      const insertVar = db.prepare('INSERT INTO item_variants (id, item_id, name, variant_values) VALUES (?, ?, ?, ?)');
      variants.forEach(v => insertVar.run(uuidv4(), req.params.id, v.name, JSON.stringify(v.values)));
    }

    const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
    const itemImages = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order').all(req.params.id);
    updated.images = itemImages.map(i => i.url);

    res.json({ item: updated });
  } catch (err) {
    console.error('Update item error:', err);
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
    console.error('Delete item error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/favorite', authenticateToken, (req, res) => {
  try {
    const existing = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?').get(req.user.id, req.params.id);

    if (existing) {
      db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ?').run(req.user.id, req.params.id);
      res.json({ favorited: false });
    } else {
      db.prepare('INSERT INTO favorites (user_id, item_id) VALUES (?, ?)').run(req.user.id, req.params.id);
      res.json({ favorited: true });
    }
  } catch (err) {
    console.error('Favorite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
