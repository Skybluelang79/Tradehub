import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import logger from '../src/logger.js';

const router = Router();

const OFFER_COLUMNS = `
  o.id, o.item_id, o.buyer_id, o.seller_id, o.amount_cents, o.currency,
  o.message, o.status, o.offered_by, o.parent_offer_id, o.responder_note,
  o.created_at, o.updated_at,
  i.title AS item_title, i.status AS item_status,
  (SELECT url FROM item_images WHERE item_id = o.item_id ORDER BY sort_order LIMIT 1) AS item_image,
  (SELECT price FROM items WHERE id = o.item_id) AS item_price,
  (SELECT sale_price FROM items WHERE id = o.item_id) AS item_sale_price,
  u.name AS buyer_name, u.avatar AS buyer_avatar,
  s.name AS seller_name, s.avatar AS seller_avatar
`;

function notify(userId, type, title, body) {
  db.prepare('INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)')
    .run(uuidv4(), userId, type, title, body);
}

function getOffer(id) {
  return db.prepare(`SELECT ${OFFER_COLUMNS} FROM offers o LEFT JOIN items i ON i.id = o.item_id LEFT JOIN users u ON u.id = o.buyer_id LEFT JOIN users s ON s.id = o.seller_id WHERE o.id = ?`).get(id);
}

// Buyer makes an offer on an item.
router.post('/', authenticateToken, (req, res) => {
  try {
    const { itemId, amountCents, message = '' } = req.body;
    const amount = Math.round(Number(amountCents));
    if (!itemId) return res.status(400).json({ error: 'Item required' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Offer amount must be greater than 0' });
    if (String(message).length > 500) return res.status(400).json({ error: 'Message too long (max 500 characters)' });

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id === req.user.id) return res.status(400).json({ error: 'Cannot make an offer on your own item' });
    if (item.status !== 'active') return res.status(400).json({ error: 'Item is not available for offers' });

    const pending = db.prepare("SELECT * FROM offers WHERE item_id = ? AND buyer_id = ? AND status = 'pending'").get(itemId, req.user.id);
    if (pending) return res.status(400).json({ error: 'You already have a pending offer on this item' });

    const id = uuidv4();
    db.prepare(`
      INSERT INTO offers (id, item_id, buyer_id, seller_id, amount_cents, currency, message, status, offered_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'buyer')
    `).run(id, itemId, req.user.id, item.seller_id, amount, item.currency || 'USD', String(message).trim());

    notify(item.seller_id, 'offer', 'New Offer Received',
      `You have a new offer of $${(amount / 100).toFixed(2)} on "${item.title}".`);

    res.status(201).json({ offer: getOffer(id) });
  } catch (err) {
    logger.error('Create offer error:', err);
    res.status(400).json({ error: err.message || 'Failed to create offer' });
  }
});

// Offers I received as a seller.
router.get('/incoming', authenticateToken, (req, res) => {
  try {
    const offers = db.prepare(`
      SELECT ${OFFER_COLUMNS} FROM offers o
      LEFT JOIN items i ON i.id = o.item_id
      LEFT JOIN users u ON u.id = o.buyer_id
      LEFT JOIN users s ON s.id = o.seller_id
      WHERE o.seller_id = ?
      ORDER BY o.created_at DESC
    `).all(req.user.id);
    res.json({ offers });
  } catch (err) {
    logger.error('Incoming offers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Offers I made as a buyer.
router.get('/outgoing', authenticateToken, (req, res) => {
  try {
    const offers = db.prepare(`
      SELECT ${OFFER_COLUMNS} FROM offers o
      LEFT JOIN items i ON i.id = o.item_id
      LEFT JOIN users u ON u.id = o.buyer_id
      LEFT JOIN users s ON s.id = o.seller_id
      WHERE o.buyer_id = ?
      ORDER BY o.created_at DESC
    `).all(req.user.id);
    res.json({ offers });
  } catch (err) {
    logger.error('Outgoing offers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Offers on a specific item (item owner or admin only).
router.get('/item/:itemId', authenticateToken, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.seller_id !== req.user.id && !req.user.isAdmin) return res.status(403).json({ error: 'Not authorized' });
    const offers = db.prepare(`SELECT ${OFFER_COLUMNS} FROM offers o LEFT JOIN items i ON i.id = o.item_id LEFT JOIN users u ON u.id = o.buyer_id LEFT JOIN users s ON s.id = o.seller_id WHERE o.item_id = ? ORDER BY o.created_at DESC`).all(item.id);
    res.json({ offers });
  } catch (err) {
    logger.error('Item offers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function validateOfferAct(req, offer, action) {
  if (!offer) { const err = new Error('Offer not found'); err.status = 404; throw err; }
  if (offer.status !== 'pending') { const err = new Error(`Offer is already ${offer.status}`); err.status = 400; throw err; }
  if (action === 'accept') {
    const isBuyersOffer = offer.offered_by === 'buyer';
    const allowed = isBuyersOffer ? offer.seller_id === req.user.id : offer.buyer_id === req.user.id;
    if (!allowed) { const err = new Error('Not authorized to accept this offer'); err.status = 403; throw err; }
  } else if (action === 'decline') {
    const isBuyersOffer = offer.offered_by === 'buyer';
    const allowed = isBuyersOffer ? offer.seller_id === req.user.id : offer.buyer_id === req.user.id;
    if (!allowed) { const err = new Error('Not authorized to decline this offer'); err.status = 403; throw err; }
  } else if (action === 'cancel') {
    const isBuyersOffer = offer.offered_by === 'buyer';
    const allowed = isBuyersOffer ? offer.buyer_id === req.user.id : offer.seller_id === req.user.id;
    if (!allowed) { const err = new Error('Not authorized to cancel this offer'); err.status = 403; throw err; }
  }
  return offer;
}

function offerParties(offer) {
  return {
    offeree: offer.offered_by === 'buyer' ? offer.seller_id : offer.buyer_id,
    offeror: offer.offered_by === 'buyer' ? offer.buyer_id : offer.seller_id,
  };
}

// Accept an offer (seller accepts a buyer's offer, or buyer accepts a counter-offer).
router.post('/:id/accept', authenticateToken, (req, res) => {
  try {
    const offer = validateOfferAct(req, getOffer(req.params.id), 'accept');
    const { offeror } = offerParties(offer);
    const isBuyersOffer = offer.offered_by === 'buyer';

    db.prepare("UPDATE offers SET status = 'accepted', updated_at = datetime('now') WHERE id = ?").run(offer.id);
    db.prepare(`UPDATE offers SET status = 'declined', updated_at = datetime('now') WHERE item_id = ? AND status = 'pending' AND id != ?`).run(offer.item_id, offer.id);

    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(offer.item_id);
    if (item && item.status === 'active') {
      db.prepare("UPDATE items SET status = 'sold', sold_to = ?, updated_at = datetime('now') WHERE id = ?").run(offer.buyer_id, offer.item_id);
    }

    notify(offeror, 'offer', 'Offer Accepted',
      isBuyersOffer
        ? `Your offer of $${(offer.amount_cents / 100).toFixed(2)} on "${offer.item_title}" was accepted. Proceed to payment.`
        : `Your counter-offer of $${(offer.amount_cents / 100).toFixed(2)} was accepted.`);

    res.json({ success: true, offer: getOffer(offer.id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Accept offer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Decline an offer.
router.post('/:id/decline', authenticateToken, (req, res) => {
  try {
    const offer = validateOfferAct(req, getOffer(req.params.id), 'decline');
    const { offeror } = offerParties(offer);
    const note = String(req.body.note || '').trim().slice(0, 500);

    db.prepare("UPDATE offers SET status = 'declined', responder_note = ?, updated_at = datetime('now') WHERE id = ?").run(note, offer.id);
    notify(offeror, 'offer', 'Offer Declined', `Your offer of $${(offer.amount_cents / 100).toFixed(2)} on "${offer.item_title}" was declined.`);

    res.json({ success: true, offer: getOffer(offer.id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Decline offer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Counter-offer: the offeree replies with a new amount. Creates a new offer
// (offered_by flips) linked to the original.
router.post('/:id/counter', authenticateToken, (req, res) => {
  try {
    const offer = validateOfferAct(req, getOffer(req.params.id), 'decline');
    const { amountCents, message = '' } = req.body;
    const amount = Math.round(Number(amountCents));
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Counter amount must be greater than 0' });

    const isBuyersOffer = offer.offered_by === 'buyer';
    const newOfferedBy = isBuyersOffer ? 'seller' : 'buyer';

    db.prepare("UPDATE offers SET status = 'countered', responder_note = ?, updated_at = datetime('now') WHERE id = ?").run(String(message).trim().slice(0, 500), offer.id);

    const id = uuidv4();
    db.prepare(`
      INSERT INTO offers (id, item_id, buyer_id, seller_id, amount_cents, currency, message, status, offered_by, parent_offer_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, offer.item_id, offer.buyer_id, offer.seller_id, amount, offer.currency, String(message).trim(), newOfferedBy, offer.id);

    notify(offer.buyer_id, 'offer', 'Counter-Offer Received',
      `You received a counter-offer of $${(amount / 100).toFixed(2)} on "${offer.item_title}".`);

    res.status(201).json({ offer: getOffer(id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Counter offer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel a pending offer (the offeror withdraws it).
router.post('/:id/cancel', authenticateToken, (req, res) => {
  try {
    const offer = validateOfferAct(req, getOffer(req.params.id), 'cancel');
    db.prepare("UPDATE offers SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(offer.id);
    const { offeree } = offerParties(offer);
    notify(offeree, 'offer', 'Offer Withdrawn', `An offer on "${offer.item_title}" was withdrawn.`);
    res.json({ success: true, offer: getOffer(offer.id) });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    logger.error('Cancel offer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;