import serverless from 'serverless-http';
import { connectLambda } from '@netlify/blobs';
import app from '../../server/app.js';
import { ensureLoaded, flushDB } from '../../server/db.js';

let handlerPromise = null;

async function getHandler() {
  if (handlerPromise) return handlerPromise;
  handlerPromise = (async () => {
    await ensureLoaded();
    return serverless(app, { binary: ['image/*', 'application/octet-stream', 'application/pdf'] });
  })();
  return handlerPromise;
}

function normalizePath(path) {
  let p = path || '/';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (p === '' || p === '/') return '/api';
  if (!p.startsWith('/api') && !p.startsWith('/uploads')) return `/api${p}`;
  return p;
}

export const handler = async (event, context) => {
  if (event?.blobs) {
    try {
      connectLambda(event);
    } catch (err) {
      console.error('connectLambda error:', err?.message);
    }
  }

  const expressHandler = await getHandler();

  const normalized = { ...event, path: normalizePath(event.path) };

  try {
    const response = await expressHandler(normalized, context);
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
};
