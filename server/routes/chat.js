import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    const conversations = db.prepare(`
      SELECT c.*,
        i.title as item_title, i.price as item_price,
        (SELECT url FROM item_images WHERE item_id = c.item_id ORDER BY sort_order LIMIT 1) as item_image,
        CASE WHEN c.buyer_id = ? THEN u2.name ELSE u1.name END as other_name,
        CASE WHEN c.buyer_id = ? THEN u2.avatar ELSE u1.avatar END as other_avatar,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND read = 0) as unread_count
      FROM conversations c
      JOIN users u1 ON c.buyer_id = u1.id
      JOIN users u2 ON c.seller_id = u2.id
      JOIN items i ON c.item_id = i.id
      WHERE c.buyer_id = ? OR c.seller_id = ?
      ORDER BY c.last_message_time DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

    res.json({ conversations });
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', authenticateToken, (req, res) => {
  try {
    const { itemId, sellerId } = req.body;

    if (!itemId || !sellerId) {
      return res.status(400).json({ error: 'itemId and sellerId are required' });
    }

    if (sellerId === req.user.id) {
      return res.status(400).json({ error: 'Cannot chat with yourself' });
    }

    let conversation = db.prepare(
      'SELECT * FROM conversations WHERE item_id = ? AND (buyer_id = ? OR buyer_id = ?)'
    ).get(itemId, req.user.id, sellerId);

    if (!conversation) {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO conversations (id, item_id, buyer_id, seller_id, last_message_time)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(id, itemId, req.user.id, sellerId);
      conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    }

    const item = db.prepare('SELECT title, price FROM items WHERE id = ?').get(itemId);
    const otherUser = db.prepare('SELECT name, avatar FROM users WHERE id = ?').get(
      conversation.buyer_id === req.user.id ? conversation.seller_id : conversation.buyer_id
    );
    const itemImage = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(itemId);

    res.json({
      conversation: {
        ...conversation,
        item_title: item?.title,
        item_price: item?.price,
        item_image: itemImage?.url,
        other_name: otherUser?.name,
        other_avatar: otherUser?.avatar,
        unread_count: 0,
      }
    });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/unread/count', authenticateToken, (req, res) => {
  try {
    const result = db.prepare(`
      SELECT COALESCE(SUM(unread), 0) as count FROM (
        SELECT COUNT(*) as unread FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE (c.buyer_id = ? OR c.seller_id = ?) AND m.sender_id != ? AND m.read = 0
      )
    `).get(req.user.id, req.user.id, req.user.id);
    res.json({ count: result.count });
  } catch (err) {
    console.error('Get unread count error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/messages', authenticateToken, (req, res) => {
  try {
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.buyer_id !== req.user.id && conversation.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
    `).all(req.params.id);

    db.prepare(`
      UPDATE messages SET read = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0
    `).run(req.params.id, req.user.id);

    res.json({ messages });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/messages', authenticateToken, (req, res) => {
  try {
    const { text, encrypted, ciphertext, iv } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Message text required' });

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    if (conversation.buyer_id !== req.user.id && conversation.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, text, encrypted, ciphertext, iv)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, req.user.id, text.trim(), encrypted ? 1 : 0, ciphertext || null, iv || null);

    db.prepare(`
      UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
    `).run(text.trim(), req.params.id);

    const message = db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(id);

    const recipientId = conversation.buyer_id === req.user.id ? conversation.seller_id : conversation.buyer_id;
    const item = db.prepare('SELECT title FROM items WHERE id = ?').get(conversation.item_id);
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body, data)
      VALUES (?, ?, 'message', 'New Message', ?, ?)
    `).run(uuidv4(), recipientId, `New message about "${item?.title}"`, JSON.stringify({ conversationId: req.params.id }));

    res.status(201).json({ message });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
