import cron from 'node-cron';
import db from '../db.js';
import logger from './logger.js';

export function startScheduler() {
  cron.schedule('0 * * * *', () => {
    logger.info('Running scheduled jobs...');

    try {
      const expired = db.prepare(
        "SELECT id, title FROM items WHERE boosted = 1 AND boost_expires_at < datetime('now')"
      ).all();

      db.prepare(
        "UPDATE items SET boosted = 0, boost_expires_at = NULL WHERE boosted = 1 AND boost_expires_at < datetime('now')"
      ).run();

      expired.forEach(item => {
        logger.info(`Boost expired for item: ${item.title} (${item.id})`);
      });

      logger.info(`Expired boosts cleared: ${expired.length} items`);
    } catch (err) {
      logger.error('Scheduler error (boost expiry):', err);
    }

    try {
      db.prepare(
        "DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', '-30 days')"
      ).run();
      logger.info('Old notifications cleaned up');
    } catch (err) {
      logger.error('Scheduler error (notification cleanup):', err);
    }
  });

  logger.info('Scheduler started');
}
