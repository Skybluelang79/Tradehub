import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
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

export function runAuctionFinalize() {
  try {
    const candidates = db.prepare(`
      SELECT * FROM items
      WHERE is_auction = 1 AND status = 'active' AND auction_status = 'active'
        AND auction_ends_at IS NOT NULL
    `).all();
    const now = new Date();
    const ended = candidates.filter((item) => new Date(item.auction_ends_at) <= now);

    for (const item of ended) {
      if (item.current_bidder_id && item.current_bid) {
        const image = db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(item.id)?.url || '';
        db.prepare(`
          INSERT INTO transactions (id, item_id, item_title, item_image, amount, buyer_id, seller_id, method, provider_ref, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'auction', ?, 'pending')
        `).run(uuidv4(), item.id, item.title, image, item.current_bid, item.current_bidder_id, item.seller_id, `auction_${item.id}`);
        db.prepare("UPDATE items SET status = 'sold', auction_status = 'ended' WHERE id = ?").run(item.id);
        db.prepare(`
          INSERT INTO notifications (id, user_id, type, title, body, data)
          VALUES (?, ?, 'sale', 'You won the auction!', ?, ?)
        `).run(uuidv4(), item.current_bidder_id, `Your winning bid of $${item.current_bid.toFixed(2)} for "${item.title}" is held in escrow.`, JSON.stringify({ itemId: item.id }));
        db.prepare(`
          INSERT INTO notifications (id, user_id, type, title, body, data)
          VALUES (?, ?, 'sale', 'Auction ended with a sale', ?, ?)
        `).run(uuidv4(), item.seller_id, `"${item.title}" sold at auction for $${item.current_bid.toFixed(2)}.`, JSON.stringify({ itemId: item.id }));
        logger.info(`Auction sold: ${item.title} (${item.id}) for $${item.current_bid}`);
      } else {
        db.prepare("UPDATE items SET auction_status = 'ended' WHERE id = ?").run(item.id);
        db.prepare(`
          INSERT INTO notifications (id, user_id, type, title, body, data)
          VALUES (?, ?, 'system', 'Auction ended with no bids', ?, ?)
        `).run(uuidv4(), item.seller_id, `Your auction for "${item.title}" ended with no bids. It remains available as a fixed-price listing.`, JSON.stringify({ itemId: item.id }));
        logger.info(`Auction ended with no bids: ${item.title} (${item.id})`);
      }
    }
  } catch (err) {
    logger.error('Scheduler error (auction finalize):', err);
  }
}

export function runSavedSearchAlerts() {
  try {
    const recentItems = db.prepare(`
      SELECT id, title, price, sale_price, category, seller_id
      FROM items
      WHERE status = 'active' AND created_at >= datetime('now', '-2 hours')
    `).all();
    if (recentItems.length === 0) return;

    const searches = db.prepare('SELECT * FROM saved_searches').all();
    let notified = 0;
    for (const s of searches) {
      const terms = String(s.query || '').toLowerCase().split(/\s+/).filter(Boolean);
      for (const item of recentItems) {
        if (item.seller_id === s.user_id) continue;
        const title = String(item.title || '').toLowerCase();
        if (terms.length && !terms.every((t) => title.includes(t))) continue;
        if (s.category && item.category && String(s.category).toLowerCase() !== String(item.category).toLowerCase()) continue;
        const price = item.sale_price ?? item.price;
        if (s.min_price != null && price < s.min_price) continue;
        if (s.max_price != null && price > s.max_price) continue;

        db.prepare(
          `INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
           VALUES (?, ?, 'saved_search', ?, ?, ?, datetime('now'))`
        ).run(
          uuidv4(),
          s.user_id,
          `New match for "${s.name}"`,
          `${item.title} is now $${price.toFixed(2)}`,
          JSON.stringify({ itemId: item.id, searchId: s.id })
        );
        notified++;
      }
    }
    if (notified > 0) logger.info(`Saved-search alerts sent: ${notified}`);
  } catch (err) {
    logger.error('Scheduler error (saved-search alerts):', err);
  }
}

export function runPriceDropAlerts() {
  try {
    const candidates = db.prepare(`
      SELECT f.user_id, f.item_id, f.price_at_add, i.title, i.price, i.sale_price
      FROM favorites f
      JOIN items i ON i.id = f.item_id
      WHERE i.status = 'active'
        AND f.price_at_add IS NOT NULL
        AND COALESCE(i.sale_price, i.price) < f.price_at_add
    `).all();

    let notified = 0;
    for (const fav of candidates) {
      const settings = db.prepare('SELECT notif_price_drops FROM user_settings WHERE user_id = ?').get(fav.user_id);
      if (settings && settings.notif_price_drops === 0) continue;

      const newPrice = fav.sale_price ?? fav.price;
      db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, data, created_at)
         VALUES (?, ?, 'price_drop', ?, ?, ?, datetime('now'))`
      ).run(
        uuidv4(),
        fav.user_id,
        `Price dropped on "${fav.title}"`,
        `The item you favorited is now $${newPrice.toFixed(2)}`,
        JSON.stringify({ itemId: fav.item_id })
      );
      db.prepare('UPDATE favorites SET price_at_add = ? WHERE user_id = ? AND item_id = ?').run(newPrice, fav.user_id, fav.item_id);
      notified++;
    }
    if (notified > 0) logger.info(`Price-drop alerts sent: ${notified}`);
  } catch (err) {
    logger.error('Scheduler error (price-drop alerts):', err);
  }
}

export function runScheduledJobs() {
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
  runPriceDropAlerts();
  runSavedSearchAlerts();
  runAuctionFinalize();
}

export function startScheduler() {
  cron.schedule('0 * * * *', runScheduledJobs);

  logger.info('Scheduler started');
}
