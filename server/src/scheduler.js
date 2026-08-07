import cron from 'node-cron';
import db from '../db.js';
import logger from './logger.js';
import { finalizeCompleted, expireAwaitingPayment } from '../routes/payments.js';

const AUTO_RELEASE_DAYS = Math.max(1, parseInt(process.env.AUTO_RELEASE_DAYS || '7', 10));
const ABANDON_HOURS = Math.max(1, parseInt(process.env.ABANDON_PAYMENT_HOURS || '24', 10));

function runEscrowAutoRelease() {
  try {
    const due = db.prepare(
      "SELECT * FROM transactions WHERE status = 'pending' AND created_at <= datetime('now', ?)"
    ).all(`-${AUTO_RELEASE_DAYS} days`);

    let released = 0;
    for (const txn of due) {
      try {
        if (finalizeCompleted(txn)) released++;
      } catch (err) {
        logger.error(`Auto-release failed for txn ${txn.id}:`, err.message);
      }
    }
    logger.info(`Escrow auto-release: ${released} transaction(s) released after ${AUTO_RELEASE_DAYS} day(s)`);
  } catch (err) {
    logger.error('Scheduler error (escrow auto-release):', err);
  }
}

function runAbandonedPaymentCleanup() {
  try {
    const abandoned = db.prepare(
      "SELECT * FROM transactions WHERE status = 'awaiting_payment' AND created_at <= datetime('now', ?)"
    ).all(`-${ABANDON_HOURS} hours`);

    let expired = 0;
    for (const txn of abandoned) {
      try {
        if (expireAwaitingPayment(txn)) expired++;
      } catch (err) {
        logger.error(`Expire failed for txn ${txn.id}:`, err.message);
      }
    }
    logger.info(`Abandoned payments cleanup: ${expired} transaction(s) expired after ${ABANDON_HOURS} hour(s)`);
  } catch (err) {
    logger.error('Scheduler error (abandoned payments cleanup):', err);
  }
}

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

    runAbandonedPaymentCleanup();
    runEscrowAutoRelease();
  });

  logger.info('Scheduler started');
}
