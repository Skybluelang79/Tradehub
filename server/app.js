import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { join } from 'path';
import fs from 'fs';
import { __dirname } from './src/paths.js';
import { errorHandler, notFound } from './src/errorHandler.js';
import { apiLimiter } from './src/rateLimiter.js';
import { allowedOrigins } from './src/env.js';

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
import payoutRoutes from './routes/payouts.js';
import settingsRoutes from './routes/settings.js';
import followRoutes from './routes/follows.js';
import searchRoutes from './routes/searches.js';

const UPLOADS_DIR = process.env.UPLOADS_DIR || join(__dirname, 'uploads');
const USE_BLOB = process.env.NETLIFY === 'true' || process.env.DB_BLOB === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const app = express();

app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: allowedOrigins(),
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

if (USE_BLOB) {
  app.get('/uploads/:filename', async (req, res, next) => {
    try {
      const { getStore } = await import('@netlify/blobs');
      const store = getStore({ name: 'tradehub-uploads' });
      const data = await store.get(`uploads/${req.params.filename}`, { type: 'arrayBuffer' });
      if (!data || data.byteLength === 0) return res.status(404).json({ error: 'File not found' });
      res.type(getContentType(req.params.filename));
      res.send(Buffer.from(data));
    } catch (err) {
      next(err);
    }
  });
} else {
  ['uploads', 'logs'].forEach(dir => {
    const p = dir === 'uploads' ? UPLOADS_DIR : join(__dirname, dir);
    try {
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    } catch {}
  });
  app.use('/uploads', express.static(UPLOADS_DIR));
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
app.use('/api/payouts', payoutRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/searches', searchRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFound);
app.use(errorHandler);

function getContentType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[ext] || 'application/octet-stream';
}

export default app;
