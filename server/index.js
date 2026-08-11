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

function isConversationMember(conversationId, userId) {
  const conv = db.prepare('SELECT buyer_id, seller_id FROM conversations WHERE id = ?').get(conversationId);
  return !!conv && (conv.buyer_id === userId || conv.seller_id === userId);
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
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conv:${conversationId}`);
  });

  socket.on('send_message', ({ conversationId, text, encrypted, ciphertext, iv }) => {
    if (!text?.trim()) return;

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (!conversation) {
      socket.emit('conversation_error', { error: 'Conversation not found' });
      return;
    }
    if (conversation.buyer_id !== socket.user.id && conversation.seller_id !== socket.user.id) {
      socket.emit('conversation_error', { error: 'Not authorized to send messages here' });
      return;
    }
    if (text.trim().length > 5000) {
      socket.emit('conversation_error', { error: 'Message too long' });
      return;
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO messages (id, conversation_id, sender_id, text, encrypted, ciphertext, iv)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, conversationId, socket.user.id, text.trim(), encrypted ? 1 : 0, ciphertext || null, iv || null);

    db.prepare(`
      UPDATE conversations SET last_message = ?, last_message_time = datetime('now') WHERE id = ?
    `).run(text.trim(), conversationId);

    const message = db.prepare(`
      SELECT m.*, u.name as sender_name, u.avatar as sender_avatar
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(id);

    io.to(`conv:${conversationId}`).emit('new_message', message);

    const recipientId = conversation.buyer_id === socket.user.id ? conversation.seller_id : conversation.buyer_id;
    const recipientSocket = onlineUsers.get(recipientId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('message_notification', {
        conversationId,
        message,
      });
    }
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
      UPDATE messages SET read = 1 WHERE conversation_id = ? AND sender_id != ? AND read = 0
    `).run(conversationId, socket.user.id);
    io.to(`conv:${conversationId}`).emit('messages_read', { userId: socket.user.id });
  });

  socket.on('disconnect', () => {
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
