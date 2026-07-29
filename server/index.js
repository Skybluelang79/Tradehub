import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import db from './db.js';
import logger from './src/logger.js';
import { errorHandler, notFound } from './src/errorHandler.js';
import { apiLimiter } from './src/rateLimiter.js';
import { startScheduler } from './src/scheduler.js';

import authRoutes from './routes/auth.js';
import itemRoutes from './routes/items.js';
import chatRoutes from './routes/chat.js';
import paymentRoutes from './routes/payments.js';
import reviewRoutes from './routes/reviews.js';
import uploadRoutes from './routes/upload.js';
import notificationRoutes from './routes/notifications.js';
import templateRoutes from './routes/templates.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import disputeRoutes from './routes/disputes.js';
import blockRoutes from './routes/blocking.js';
import promotionRoutes from './routes/promotions.js';
import webhookRoutes from './routes/webhooks.js';
import subscriptionRoutes from './routes/subscriptions.js';
import settingsRoutes from './routes/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
});

['uploads', 'logs'].forEach(dir => {
  const p = join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(join(__dirname, 'uploads')));

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

app.use('/api', apiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/blocking', blockRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/settings', settingsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFound);
app.use(errorHandler);

const onlineUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'tradehub-secret-key-change-in-production-2026');
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
    socket.join(`conv:${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conv:${conversationId}`);
  });

  socket.on('send_message', ({ conversationId, text, encrypted, ciphertext, iv }) => {
    if (!text?.trim()) return;

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

    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    if (conversation) {
      const recipientId = conversation.buyer_id === socket.user.id ? conversation.seller_id : conversation.buyer_id;
      const recipientSocket = onlineUsers.get(recipientId);
      if (recipientSocket) {
        io.to(recipientSocket).emit('message_notification', {
          conversationId,
          message,
        });
      }
    }
  });

  socket.on('typing_start', (conversationId) => {
    socket.to(`conv:${conversationId}`).emit('user_typing', {
      userId: socket.user.id,
      name: socket.user.name,
    });
  });

  socket.on('typing_stop', (conversationId) => {
    socket.to(`conv:${conversationId}`).emit('user_stop_typing', {
      userId: socket.user.id,
    });
  });

  socket.on('mark_read', (conversationId) => {
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
server.listen(PORT, () => {
  logger.info(`TradeHub API running on http://localhost:${PORT}`);
  logger.info(`WebSocket ready on port ${PORT}`);
});
