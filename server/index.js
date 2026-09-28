import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import app from './app.js';
import db, { flushDB } from './db.js';
import logger from './src/logger.js';
import { requiredEnv, allowedOrigins } from './src/env.js';
import { startScheduler } from './src/scheduler.js';
import { ensureLoaded } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const server = createServer(app);
const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, 'uploads');
const JWT_SECRET = requiredEnv('JWT_SECRET', 'tradehub-secret-key-change-in-production-2026');
const io = new Server(server, {
  cors: {
    origin: allowedOrigins(),
    methods: ['GET', 'POST'],
  },
});

const frontendDist = join(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDist)) {
  app.use('/Tradehub', express.static(join(frontendDist, 'Tradehub')));
  app.get('/Tradehub/*', (req, res) => {
    res.sendFile(join(frontendDist, 'Tradehub', 'index.html'));
  });
  app.get('/', (req, res) => {
    res.redirect('/Tradehub/');
  });
}

const onlineUsers = new Map();
const activeCalls = new Map();

function isConversationMember(conversationId, userId) {
  const conv = db.prepare('SELECT buyer_id, seller_id FROM conversations WHERE id = ?').get(conversationId);
  return !!conv && (conv.buyer_id === userId || conv.seller_id === userId);
}

function otherParticipant(conversation, userId) {
  return conversation.buyer_id === userId ? conversation.seller_id : conversation.buyer_id;
}

function isBlockedByEither(userA, userB) {
  const blocked = db.prepare(`
    SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
  `).get(userA, userB, userB, userA);
  return !!blocked;
}

function isRecipientInRoom(conversationId, recipientId) {
  const room = io.sockets.adapter.rooms.get(`conv:${conversationId}`);
  if (!room) return false;
  const socketId = onlineUsers.get(recipientId);
  return !!socketId && room.has(socketId);
}

function messagePreview(type, text, encrypted, attachments) {
  if (type === 'file' && attachments?.length) {
    const att = attachments[0];
    return `📎 ${att.filename || 'Attachment'}`;
  }
  if (type === 'call') return text || 'Call';
  if (encrypted) return '🔒 Encrypted message';
  return text || '';
}

function buildMessage(message) {
  const attachments = db.prepare(
    'SELECT id, kind, url, filename, mime, size FROM message_attachments WHERE message_id = ? ORDER BY created_at ASC'
  ).all(message.id);
  let reply_to = null;
  if (message.reply_to_id) {
    const r = db.prepare('SELECT id, sender_id, text, type, encrypted FROM messages WHERE id = ?')
      .get(message.reply_to_id);
    if (r) {
      reply_to = {
        id: r.id,
        sender_id: r.sender_id,
        text: r.encrypted ? '🔒 Encrypted message' : (r.type === 'file' ? '📎 Attachment' : r.text),
      };
    }
  }
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    text: message.text,
    type: message.type || 'text',
    encrypted: !!message.encrypted,
    ciphertext: message.ciphertext,
    iv: message.iv,
    read: !!message.read,
    delivered: !!message.delivered,
    reply_to_id: message.reply_to_id,
    reply_to,
    created_at: message.created_at,
    sender_name: message.sender_name,
    sender_avatar: message.sender_avatar,
    attachments,
  };
}

function insertSystemCallMessage(conversation, callerId, text) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, text, type)
    VALUES (?, ?, ?, ?, 'call')
  `).run(id, conversation.id, callerId, text, 'call');
  db.prepare(`
    UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
  `).run(`📞 ${text}`, conversation.id);
  const message = db.prepare(`
    SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(id);
  return buildMessage(message);
}

function formatCallSummary(kind, status, durationSeconds) {
  const typeLabel = kind === 'video' ? 'Video call' : 'Voice call';
  if (status === 'missed' || status === 'rejected' && !durationSeconds) return `${typeLabel} · missed`;
  if (status === 'cancelled') return `${typeLabel} · cancelled`;
  if (durationSeconds) {
    const mins = Math.floor(durationSeconds / 60);
    const secs = durationSeconds % 60;
    return `${typeLabel} · ${mins}m ${secs}s`;
  }
  return `${typeLabel} · ended`;
}

function emitToCallParticipants(callId, event, payload) {
  const call = activeCalls.get(callId);
  if (!call) return;
  const callerSocket = onlineUsers.get(call.callerId);
  const calleeSocket = onlineUsers.get(call.calleeId);
  if (callerSocket) io.to(callerSocket).emit(event, payload);
  if (calleeSocket) io.to(calleeSocket).emit(event, payload);
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, name, avatar FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`User connected: ${socket.user.name}`);
  onlineUsers.set(socket.user.id, socket.id);
  io.emit('online_users', Array.from(onlineUsers.keys()));

  socket.on('join_conversation', (conversationId) => {
    if (!isConversationMember(conversationId, socket.user.id)) {
      socket.emit('conversation_error', { error: 'Not authorized to join this conversation' });
      return;
    }
    socket.join(`conv:${conversationId}`);
    db.prepare(`
      UPDATE messages SET delivered = 1 WHERE conversation_id = ? AND sender_id != ? AND delivered = 0
    `).run(conversationId, socket.user.id);
    socket.to(`conv:${conversationId}`).emit('messages_delivered', {
      conversationId,
      userId: socket.user.id,
    });
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conv:${conversationId}`);
  });

  socket.on('send_message', ({ conversationId, text, encrypted, ciphertext, iv, type = 'text', attachments = [], replyTo }) => {
    const isFile = type === 'file';
    if (!isFile && !text?.trim()) return;

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation) {
      socket.emit('conversation_error', { error: 'Conversation not found' });
      return;
    }
    if (!isConversationMember(conversationId, socket.user.id)) {
      socket.emit('conversation_error', { error: 'Not authorized to send messages here' });
      return;
    }
    const recipientId = otherParticipant(conversation, socket.user.id);
    if (isBlockedByEither(socket.user.id, recipientId)) {
      socket.emit('conversation_error', { error: 'Message blocked' });
      return;
    }
    if (!isFile && text.trim().length > 5000) {
      socket.emit('conversation_error', { error: 'Message too long' });
      return;
    }
    if (attachments && attachments.length > 6) {
      socket.emit('conversation_error', { error: 'Too many attachments (max 6)' });
      return;
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, text, encrypted, ciphertext, iv, type, reply_to_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, socket.user.id, isFile ? '' : text.trim(), encrypted ? 1 : 0, ciphertext || null, iv || null, type, replyTo || null);

    for (const att of attachments || []) {
      if (!att.url) continue;
      db.prepare(`
        INSERT INTO message_attachments (id, message_id, conversation_id, sender_id, kind, url, filename, mime, size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), id, conversationId, socket.user.id, att.kind || 'image', att.url, att.filename || 'Attachment', att.mime || '', Number(att.size) || 0);
    }

    const preview = messagePreview(type, (text || '').trim(), !!encrypted, attachments);
    db.prepare(`
      UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
    `).run(preview, conversationId);

    const raw = db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(id);

    const delivered = isRecipientInRoom(conversationId, recipientId);
    if (delivered) {
      db.prepare('UPDATE messages SET delivered = 1 WHERE id = ?').run(id);
      raw.delivered = 1;
    }

    const message = buildMessage(raw);
    io.to(`conv:${conversationId}`).emit('new_message', message);

    if (type !== 'call') {
      const item = db.prepare('SELECT title FROM items WHERE id = ?').get(conversation.item_id);
      const recipientSocket = onlineUsers.get(recipientId);
      if (recipientSocket) {
        io.to(recipientSocket).emit('message_notification', {
          conversationId,
          message,
        });
      }
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, title, body, data)
        VALUES (?, ?, 'message', 'New Message', ?, ?)
      `).run(uuidv4(), recipientId, `New message about "${item?.title}"`, JSON.stringify({ conversationId }));
    }
  });

  socket.on('block_user', ({ conversationId, userId }) => {
    if (!isConversationMember(conversationId, socket.user.id)) return;
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation) return;
    const blockedId = userId || otherParticipant(conversation, socket.user.id);
    if (!isConversationMember(conversationId, blockedId)) return;
    const existing = db.prepare('SELECT * FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').get(socket.user.id, blockedId);
    if (existing) return;
    db.prepare('INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)').run(socket.user.id, blockedId);
    db.prepare(`
      INSERT INTO notifications (id, user_id, type, title, body, data)
      VALUES (?, ?, 'system', 'User blocked', 'You blocked this user', ?)
    `).run(uuidv4(), socket.user.id, JSON.stringify({ userId: blockedId }));
    socket.emit('block_success', { conversationId, userId: blockedId });
  });

  socket.on('report_user', ({ conversationId, reason, description = '' }) => {
    if (!isConversationMember(conversationId, socket.user.id)) return;
    if (!reason || reason.trim().length < 2) {
      socket.emit('conversation_error', { error: 'A reason is required' });
      return;
    }
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation) return;
    const reportedId = otherParticipant(conversation, socket.user.id);
    if (!isConversationMember(conversationId, reportedId)) return;
    const id = uuidv4();
    db.prepare(`
      INSERT INTO user_reports (id, reported_user_id, reporter_id, reason, description, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `).run(id, reportedId, socket.user.id, reason.trim(), description.trim());
    socket.emit('report_success', { reportId: id, userId: reportedId });
  });

  socket.on('typing_start', (conversationId) => {
    if (!isConversationMember(conversationId, socket.user.id)) return;
    socket.to(`conv:${conversationId}`).emit('user_typing', {
      userId: socket.user.id,
      name: socket.user.name,
    });
  });

  socket.on('typing_stop', (conversationId) => {
    if (!isConversationMember(conversationId, socket.user.id)) return;
    socket.to(`conv:${conversationId}`).emit('user_stop_typing', {
      userId: socket.user.id,
    });
  });

  socket.on('mark_read', (conversationId) => {
    if (!isConversationMember(conversationId, socket.user.id)) return;
    db.prepare(`
      UPDATE messages SET read = 1, delivered = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0
    `).run(conversationId, socket.user.id);
    io.to(`conv:${conversationId}`).emit('messages_read', { userId: socket.user.id });
  });

  socket.on('call_user', ({ conversationId, kind = 'audio', callId }) => {
    if (!callId) return;
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation || !isConversationMember(conversationId, socket.user.id)) {
      socket.emit('conversation_error', { error: 'Conversation not found' });
      return;
    }
    const calleeId = otherParticipant(conversation, socket.user.id);
    if (isBlockedByEither(socket.user.id, calleeId)) {
      socket.emit('conversation_error', { error: 'Call blocked' });
      return;
    }
    const calleeSocket = onlineUsers.get(calleeId);
    if (!calleeSocket) {
      socket.emit('call_unavailable', { callId, reason: 'User offline' });
      return;
    }

    activeCalls.set(callId, { conversationId, callerId: socket.user.id, calleeId, kind });
    db.prepare(`
      INSERT INTO call_logs (id, conversation_id, caller_id, callee_id, kind, status, started_at)
      VALUES (?, ?, ?, ?, ?, 'ringing', datetime('now'))
    `).run(callId, conversationId, socket.user.id, calleeId, kind);

    io.to(calleeSocket).emit('incoming_call', {
      callId,
      conversationId,
      kind,
      callerId: socket.user.id,
      callerName: socket.user.name,
      callerAvatar: socket.user.avatar,
      itemTitle: db.prepare('SELECT title FROM items WHERE id = ?').get(conversation.item_id)?.title,
    });
  });

  socket.on('call_accept', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    if (socket.user.id !== call.calleeId) return;
    db.prepare(`
      UPDATE call_logs SET status = 'active', answered_at = datetime('now') WHERE id = ?
    `).run(callId);
    emitToCallParticipants(callId, 'call_accepted', { callId });
  });

  socket.on('call_reject', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    if (socket.user.id !== call.calleeId) return;
    db.prepare(`
      UPDATE call_logs SET status = 'rejected', ended_at = datetime('now') WHERE id = ?
    `).run(callId);
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(call.conversationId);
    if (conversation) {
      const sys = insertSystemCallMessage(conversation, call.callerId, formatCallSummary(call.kind, 'rejected', 0));
      io.to(`conv:${call.conversationId}`).emit('new_message', sys);
    }
    emitToCallParticipants(callId, 'call_rejected', { callId });
    activeCalls.delete(callId);
  });

  socket.on('call_cancel', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;
    if (socket.user.id !== call.callerId) return;
    db.prepare(`
      UPDATE call_logs SET status = 'cancelled', ended_at = datetime('now') WHERE id = ?
    `).run(callId);
    emitToCallParticipants(callId, 'call_cancelled', { callId });
    activeCalls.delete(callId);
  });

  socket.on('call_end', ({ callId }) => {
    const call = activeCalls.get(callId);
    if (!call) return;

    let status = 'completed';
    let durationSeconds = 0;
    try {
      const row = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(callId);
      if (row) {
        const answeredMs = row.answered_at ? new Date(`${row.answered_at}Z`).getTime() : null;
        const endMs = Date.now();
        if (answeredMs) {
          durationSeconds = Math.max(1, Math.round((endMs - answeredMs) / 1000));
        } else {
          status = 'missed';
        }
        db.prepare(`
          UPDATE call_logs SET status = ?, ended_at = datetime('now'), duration_seconds = ? WHERE id = ?
        `).run(status, durationSeconds, callId);
      }
    } catch (err) {
      console.error('End call error:', err);
    }

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(call.conversationId);
    if (conversation) {
      const sys = insertSystemCallMessage(conversation, call.callerId, formatCallSummary(call.kind, status, durationSeconds));
      io.to(`conv:${call.conversationId}`).emit('new_message', sys);
    }

    emitToCallParticipants(callId, 'call_ended', { callId, status, durationSeconds });
    activeCalls.delete(callId);
  });

  const relayToPeer = (peerEventName) => (payload) => {
    if (!payload?.callId) return;
    const call = activeCalls.get(payload.callId);
    if (!call) return;
    const peerId = socket.user.id === call.callerId ? call.calleeId : call.callerId;
    const peerSocket = onlineUsers.get(peerId);
    if (peerSocket) {
      io.to(peerSocket).emit(peerEventName, payload);
    }
  };

  socket.on('rtc_offer', relayToPeer('rtc_offer'));
  socket.on('rtc_answer', relayToPeer('rtc_answer'));
  socket.on('rtc_ice', relayToPeer('rtc_ice'));

  socket.on('disconnect', () => {
    for (const [callId, call] of activeCalls) {
      if (call.callerId === socket.user.id || call.calleeId === socket.user.id) {
        emitToCallParticipants(callId, 'call_ended', { callId, status: 'disconnected', durationSeconds: 0 });
        activeCalls.delete(callId);
      }
    }
    onlineUsers.delete(socket.user.id);
    io.emit('online_users', Array.from(onlineUsers.keys()));
    logger.info(`User disconnected: ${socket.user.name}`);
  });
});

startScheduler();

const PORT = process.env.PORT || 3001;

ensureLoaded().then(() => {
  server.listen(PORT, () => {
    logger.info(`TradeHub API running on http://localhost:${PORT}`);
    logger.info(`WebSocket ready on port ${PORT}`);
  });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  try {
    await new Promise((resolve) => {
      server.close(resolve);
      io.close();
      setTimeout(resolve, 5000).unref();
    });
    await flushDB();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
