import { connectLambda } from '@netlify/blobs';
import { ensureLoaded, flushDB } from '../../server/db.js';
import { runScheduledJobs } from '../../server/src/scheduler.js';

export const schedule = '0 * * * *';

export default async (event) => {
  if (event?.blobs) {
    try {
      connectLambda(event);
    } catch (err) {
      console.error('connectLambda error:', err?.message);
    }
  }

  try {
    await ensureLoaded();
    runScheduledJobs();
    await flushDB();
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Scheduled job error:', err?.message);
    try {
      await flushDB();
    } catch {}
    return { statusCode: 500, body: 'error' };
  }
};
