import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { chatSearchLimiter } from '../src/rateLimiter.js';

const router = Router();

function getOtherParticipant(conversation, userId) {
  return conversation.buyer_id === userId ? conversation.seller_id : conversation.buyer_id;
}

function isBlockedByEither(userA, userB) {
  const blocked = db.prepare(`
    SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
  `).get(userA, userB, userB, userA);
  return !!blocked;
}

function messagePreview(type, text, encrypted, attachments) {
  if (type === 'file' && attachments?.length) {
    const att = attachments[0];
    return `📎 ${att.filename || 'Attachment'}`;
  }
  if (type === 'call') {
    return text || 'Call';
  }
  if (encrypted) {
    return '🔒 Encrypted message';
  }
  return text || '';
}

function rowToMessage(m) {
  const attachments = db.prepare(
    'SELECT id, kind, url, filename, mime, size FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC'
  ).all(m.id);
  let replyTo = null;
  if (m.reply_to_id) {
    const r = db.prepare(
      'SELECT id, sender_id, text, type, encrypted FROM messages WHERE id = ?'
    ).get(m.reply_to_id);
    if (r) {
      replyTo = {
        id: r.id,
        senderId: r.sender_id,
        text: r.encrypted ? '🔒 Encrypted message' : (r.type === 'file' ? '📎 Attachment' : r.text),
      };
    }
  }
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    text: m.text,
    type: m.type || 'text',
    encrypted: !!m.encrypted,
    ciphertext: m.ciphertext,
    iv: m.iv,
    read: !!m.read,
    delivered: !!m.delivered,
    reply_to_id: m.reply_to_id,
    reply_to: replyTo,
    created_at: m.created_at,
    sender_name: m.sender_name,
    sender_avatar: m.sender_avatar,
    attachments,
  };
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const conversations = db.prepare(`
      SELECT c.*,
        i.title as item_title, i.price as item_price,
        (SELECT url FROM item_images WHERE item_id = c.item_id ORDER BY sort_order LIMIT 1) as item_image,
        CASE WHEN c.buyer_id = ? THEN u2.name ELSE u1.name END as other_name,
        CASE WHEN c.buyer_id = ? THEN u2.avatar ELSE u1.avatar END as other_avatar,
        CASE WHEN c.buyer_id = ? THEN u2.verified ELSE u1.verified END as other_verified,
        cs.pinned, cs.muted,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != ? AND read = 0) as unread_count
      FROM conversations c
      JOIN users u1 ON c.buyer_id = u1.id
      JOIN users u2 ON c.seller_id = u2.id
      JOIN items i ON c.item_id = i.id
      LEFT JOIN conversation_settings cs ON cs.conversation_id = c.id AND cs.user_id = ?
      WHERE c.buyer_id = ? OR c.seller_id = ?
      ORDER BY cs.pinned DESC, c.last_message_time DESC
    `).all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);

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

    if (isBlockedByEither(req.user.id, sellerId)) {
      return res.status(403).json({ error: 'Unable to start a conversation with this user' });
    }

    const item = db.prepare('SELECT id, title, price, status FROM items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

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

    const otherUser = db.prepare('SELECT name, avatar, verified FROM users WHERE id = ?').get(getOtherParticipant(conversation, req.user.id));
    const itemImage = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(itemId);
    const settings = db.prepare('SELECT pinned, muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?')
      .get(conversation.id, req.user.id);

    res.json({
      conversation: {
        ...conversation,
        item_title: item?.title,
        item_price: item?.price,
        item_image: itemImage?.url,
        other_name: otherUser?.name,
        other_avatar: otherUser?.avatar,
        other_verified: otherUser?.verified,
        pinned: settings?.pinned || 0,
        muted: settings?.muted || 0,
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

router.put('/public-key', authenticateToken, (req, res) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || typeof publicKey !== 'string' || publicKey.length > 4096) {
      return res.status(400).json({ error: 'A valid public key is required' });
    }
    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Save public key error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/peer-public-key', authenticateToken, (req, res) => {
  try {
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const peerId = getOtherParticipant(access.conversation, req.user.id);
    const peer = db.prepare('SELECT public_key FROM users WHERE id = ?').get(peerId);
    res.json({ publicKey: peer?.public_key || null, peerId });
  } catch (err) {
    console.error('Get peer public key error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/search', authenticateToken, chatSearchLimiter, (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ results: [] });

    const like = `%${q}%`;
    const results = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, m.text, m.type, m.encrypted, m.created_at,
        u.name as sender_name,
        CASE WHEN c.buyer_id = ? THEN s.name ELSE b.name END as other_name
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      JOIN users u ON m.sender_id = u.id
      JOIN users b ON c.buyer_id = b.id
      JOIN users s ON c.seller_id = s.id
      WHERE (c.buyer_id = ? OR c.seller_id = ?)
        AND m.encrypted = 0 AND m.type = 'text'
        AND m.text LIKE ?
      ORDER BY m.created_at DESC
      LIMIT 50
    `).all(req.user.id, req.user.id, req.user.id, like);

    res.json({ results });
  } catch (err) {
    console.error('Search messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function ensureConversationAccess(conversationId, userId) {
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
  if (!conversation) return { error: 'Conversation not found', code: 404 };
  if (conversation.buyer_id !== userId && conversation.seller_id !== userId) {
    return { error: 'Not authorized', code: 403 };
  }
  return { conversation };
}

router.get('/:id/messages', authenticateToken, (req, res) => {
  try {
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const messages = db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.created_at ASC
    `).all(req.params.id);

    db.prepare(`
      UPDATE messages SET read = 1, delivered = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0
    `).run(req.params.id, req.user.id);

    res.json({ messages: messages.map(rowToMessage) });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/messages', authenticateToken, (req, res) => {
  try {
    const { text, encrypted, ciphertext, iv, type = 'text', attachments = [], replyTo } = req.body;
    const isFile = type === 'file';
    const isCall = type === 'call';

    if (!isCall && !text && !isFile) return res.status(400).json({ error: 'Message text required' });
    if (isFile && (!Array.isArray(attachments) || attachments.length === 0)) {
      return res.status(400).json({ error: 'Attachments required for file messages' });
    }
    if (attachments.length > 6) return res.status(400).json({ error: 'Too many attachments (max 6)' });

    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });
    const conversation = access.conversation;

    if (isBlockedByEither(req.user.id, getOtherParticipant(conversation, req.user.id))) {
      return res.status(403).json({ error: 'Message blocked' });
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, text, encrypted, ciphertext, iv, type, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.params.id,
      req.user.id,
      isFile ? '' : (text || '').trim(),
      encrypted ? 1 : 0,
      ciphertext || null,
      iv || null,
      type,
      replyTo || null
    );

    for (const att of attachments) {
      const row = {
        kind: att.kind || 'image',
        url: att.url,
        filename: att.filename || 'Attachment',
        mime: att.mime || '',
        size: Number(att.size) || 0,
      };
      if (!row.url) continue;
      db.prepare(`
        INSERT INTO message_attachments (id, message_id, conversation_id, sender_id, kind, url, filename, mime, size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), id, req.params.id, req.user.id, row.kind, row.url, row.filename, row.mime, row.size);
    }

    const preview = messagePreview(type, (text || '').trim(), !!encrypted, attachments);
    if (isFile) {
      db.prepare(`
        UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
      `).run(preview, req.params.id);
    } else if (type === 'call') {
      db.prepare(`
        UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
      `).run(preview, req.params.id);
    } else {
      db.prepare(`
        UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
      `).run(preview, req.params.id);
    }

    const message = db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(id);

    const recipientId = getOtherParticipant(conversation, req.user.id);
    if (!isCall) {
      const item = db.prepare('SELECT title FROM items WHERE id = ?').get(conversation.item_id);
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, data)
        VALUES (?, ?, 'message', 'New Message', ?, ?)
      `).run(uuidv4(), recipientId, `New message about "${item?.title}"`, JSON.stringify({ conversationId: req.params.id }));
    }

    res.status(201).json({ message: rowToMessage(message) });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/attachments', authenticateToken, (req, res) => {
  try {
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const attachments = db.prepare(`
      SELECT a.*, u.name as sender_name, m.created_at as message_time
      FROM message_attachments a
      JOIN messages m ON a.message_id = m.id
      JOIN users u ON a.sender_id = u.id
      WHERE a.conversation_id = ?
      ORDER BY a.created_at DESC
    `).all(req.params.id);

    res.json({ attachments });
  } catch (err) {
    console.error('Get attachments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/search', authenticateToken, chatSearchLimiter, (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });
    if (!q) return res.json({ matches: [] });

    const like = `%${q}%`;
    const matches = db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_id, m.text, m.type, m.encrypted, m.created_at
      FROM messages m
      WHERE m.conversation_id = ? AND m.encrypted = 0 AND m.type = 'text' AND m.text LIKE ?
      ORDER BY m.created_at ASC
    `).all(req.params.id, like);

    res.json({ matches });
  } catch (err) {
    console.error('Search conversation messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/export', authenticateToken, chatSearchLimiter, (req, res) => {
  try {
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const rows = db.prepare(`
      SELECT m.*, u.name as sender_name
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ? ORDER BY m.created_at ASC
    `).all(req.params.id);

    const messages = rows.map(rowToMessage);
    const time = new Date().toLocaleString();
    let text = `TradeHub Chat Export — ${time}\n${'='.repeat(60)}\n\n`;
    for (const m of messages) {
      const name = m.sender_name || 'Unknown';
      const ts = new Date(m.created_at + 'Z').toLocaleString();
      if (m.type === 'file') {
        const names = m.attachments.map((a) => a.filename).join(', ') || 'Attachment';
        text += `[${ts}] ${name}: 📎 ${names}\n`;
      } else if (m.type === 'call') {
        text += `[${ts}] ${m.text}\n`;
      } else if (m.encrypted) {
        text += `[${ts}] ${name}: 🔒 Encrypted message\n`;
      } else {
        text += `[${ts}] ${name}: ${m.text}\n`;
      }
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${req.params.id}.txt"`);
    res.send(text);
  } catch (err) {
    console.error('Export conversation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/settings', authenticateToken, (req, res) => {
  try {
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const settings = db.prepare(
      'SELECT pinned, muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    res.json({ settings: { pinned: !!settings?.pinned, muted: !!settings?.muted } });
  } catch (err) {
    console.error('Get conversation settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/settings', authenticateToken, (req, res) => {
  try {
    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const current = db.prepare(
      'SELECT pinned, muted FROM conversation_settings WHERE conversation_id = ? AND user_id = ?'
    ).get(req.params.id, req.user.id);

    const pinned = typeof req.body.pinned === 'boolean' ? (req.body.pinned ? 1 : 0) : (current?.pinned || 0);
    const muted = typeof req.body.muted === 'boolean' ? (req.body.muted ? 1 : 0) : (current?.muted || 0);

    db.prepare(`
      INSERT INTO conversation_settings (conversation_id, user_id, pinned, muted, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(conversation_id, user_id)
      DO UPDATE SET pinned = excluded.pinned, muted = excluded.muted, updated_at = datetime('now')
    `).run(req.params.id, req.user.id, pinned, muted);

    res.json({ settings: { pinned: !!pinned, muted: !!muted } });
  } catch (err) {
    console.error('Update conversation settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/unsend', authenticateToken, (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ error: 'messageId is required' });

    const access = ensureConversationAccess(req.params.id, req.user.id);
    if (access.error) return res.status(access.code).json({ error: access.error });

    const message = db.prepare('SELECT id, sender_id FROM messages WHERE id = ? AND conversation_id = ?')
      .get(messageId, req.params.id);
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.sender_id !== req.user.id) return res.status(403).json({ error: 'You can only remove your own messages' });

    db.prepare('UPDATE messages SET deleted_for_sender = 1 WHERE id = ?').run(messageId);
    res.json({ success: true });
  } catch (err) {
    console.error('Unsend message error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;