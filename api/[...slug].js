import serverless from 'serverless-http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import app from '../server/app.js';
import { ensureLoaded, flushDB } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

let handlerPromise = null;

async function getHandler() {
  if (handlerPromise) return handlerPromise;
  handlerPromise = (async () => {
    await ensureLoaded();
    return serverless(app, { binary: ['image/*', 'application/octet-stream', 'application/pdf'] });
  })();
  return handlerPromise;
}

export default async function handler(event, context) {
  const expressHandler = await getHandler();
  const pathname = event.path || '/';
  const isApi = pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/uploads/');

  if (!isApi) {
    const indexHtml = path.join(distDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: fs.readFileSync(indexHtml, 'utf8'),
      };
    }
  }

  try {
    const response = await expressHandler(event, context);
    await flushDB();
    return response;
  } catch (err) {
    await flushDB();
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}
