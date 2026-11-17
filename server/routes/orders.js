import { Router } from 'express';
import db from '../db.js';
import logger from '../src/logger.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  confirmDelivery,
  createShipment,
  issueInvoice,
  listOrders,
  orderDetail,
  syncOrderPaymentState,
  updateShipment,
} from '../ordersService.js';

const router = Router();

function fail(res, err, label) {
  if (err?.status) return res.status(err.status).json({ error: err.message });
  logger.error(`${label}:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

router.get('/', authenticateToken, (req, res) => {
  try {
    const role = ['all', 'buyer', 'seller'].includes(req.query.role) ? req.query.role : 'all';
    res.json({ orders: listOrders(req.user, role), role });
  } catch (err) {
    fail(res, err, 'List orders error');
  }
});

router.get('/:id', authenticateToken, (req, res) => {
  try {
    res.json({ order: orderDetail(req.params.id, req.user) });
  } catch (err) {
    fail(res, err, 'Get order error');
  }
});

router.post('/:id/shipments', authenticateToken, (req, res) => {
  try {
    res.status(201).json({ order: createShipment(req.params.id, req.user, req.body || {}) });
  } catch (err) {
    fail(res, err, 'Create shipment error');
  }
});

router.put('/:id/shipments/:shipmentId', authenticateToken, (req, res) => {
  try {
    res.json({ order: updateShipment(req.params.id, req.params.shipmentId, req.user, req.body || {}) });
  } catch (err) {
    fail(res, err, 'Update shipment error');
  }
});

router.post('/:id/confirm-delivery', authenticateToken, async (req, res) => {
  try {
    res.json({ order: await confirmDelivery(req.params.id, req.user) });
  } catch (err) {
    fail(res, err, 'Confirm delivery error');
  }
});

router.post('/:id/invoice', authenticateToken, (req, res) => {
  try {
    res.json({ order: issueInvoice(req.params.id, req.user) });
  } catch (err) {
    fail(res, err, 'Issue invoice error');
  }
});

router.post('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const order = orderDetail(req.params.id, req.user);
    if (!['buyer', 'admin'].includes(order.viewer_role)) {
      return res.status(403).json({ error: 'Only the buyer can cancel this order' });
    }
    if (['shipped', 'partially_shipped', 'delivered', 'completed', 'cancelled', 'refunded'].includes(order.status)) {
      return res.status(400).json({ error: 'This order can no longer be cancelled' });
    }

    const { refundTxn } = await import('./payments.js');
    for (const txn of db.prepare('SELECT * FROM transactions WHERE order_id = ?').all(order.id)) {
      if (['pending', 'completed'].includes(txn.status)) {
        await refundTxn(txn);
      } else if (txn.status === 'awaiting_payment') {
        db.prepare("UPDATE transactions SET status = 'expired' WHERE id = ?").run(txn.id);
      }
    }
    db.prepare(`
      UPDATE orders SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(order.id);
    db.prepare(`
      UPDATE order_items SET status = 'cancelled' WHERE order_id = ? AND status NOT IN ('refunded')
    `).run(order.id);
    db.prepare(`
      INSERT INTO order_events (id, order_id, type, actor_id, data)
      VALUES (lower(hex(randomblob(16))), ?, 'order_cancelled', ?, '{}')
    `).run(order.id, req.user.id);
    res.json({ order: orderDetail(order.id, req.user) });
  } catch (err) {
    fail(res, err, 'Cancel order error');
  }
});

router.post('/:id/refund', authenticateToken, async (req, res) => {
  try {
    const order = orderDetail(req.params.id, req.user);
    if (order.viewer_role === 'seller') {
      return res.status(403).json({ error: 'Only the buyer or an admin can request a refund' });
    }
    if (['cancelled', 'refunded', 'awaiting_payment', 'pending'].includes(order.status)) {
      return res.status(400).json({ error: 'This order cannot be refunded' });
    }

    const amountCents = req.body?.amountCents != null
      ? Math.max(0, Math.round(Number(req.body.amountCents) || 0))
      : null;
    const itemId = req.body?.itemId || null;
    const refundable = db.prepare(`
      SELECT * FROM transactions WHERE order_id = ?
      AND status IN ('pending', 'completed')
      ${itemId ? 'AND item_id = ?' : ''}
    `).all(...(itemId ? [order.id, itemId] : [order.id]));
    if (!refundable.length) return res.status(400).json({ error: 'No refundable payments found' });

    const { refundTxn } = await import('./payments.js');
    if (amountCents == null || amountCents >= Math.round(refundable.reduce(
      (sum, txn) => sum + Math.round(Number(txn.amount) * 100) - Number(txn.refunded_cents || 0),
      0,
    ))) {
      for (const txn of refundable) await refundTxn(txn);
      db.prepare(`
        UPDATE order_items SET status = 'refunded', refunded_cents = unit_price_cents * quantity
        WHERE order_id = ? ${itemId ? 'AND item_id = ?' : ''}
      `).run(...(itemId ? [order.id, itemId] : [order.id]));
    } else {
      let remaining = amountCents;
      for (const txn of refundable) {
        if (remaining <= 0) break;
        const txnCents = Math.round(Number(txn.amount) * 100);
        const already = Number(txn.refunded_cents || 0);
        const available = Math.max(0, txnCents - already);
        const take = Math.min(remaining, available);
        remaining -= take;
        const totalRefunded = already + take;
        db.prepare('UPDATE transactions SET refunded_cents = ? WHERE id = ?').run(totalRefunded, txn.id);
        if (totalRefunded >= txnCents) await refundTxn({ ...txn, refunded_cents: already });
        db.prepare(`
          UPDATE order_items SET refunded_cents = MIN(unit_price_cents * quantity, refunded_cents + ?)
          ${totalRefunded >= txnCents ? ", status = 'refunded'" : ''}
          WHERE order_id = ? AND item_id = ?
        `).run(take, order.id, txn.item_id);
      }
    }

    const refundedCents = db.prepare(
      'SELECT COALESCE(SUM(refunded_cents), 0) AS total FROM transactions WHERE order_id = ?'
    ).get(order.id).total;
    const totalCents = Math.round(Number(order.total_cents) || 0);
    db.prepare(`
      UPDATE orders SET refunded_cents = ?, status = ?, updated_at = datetime('now') WHERE id = ?
    `).run(
      refundedCents,
      refundedCents >= totalCents ? 'refunded' : 'partially_refunded',
      order.id,
    );
    syncOrderPaymentState(order.id);
    db.prepare(`
      INSERT INTO order_events (id, order_id, type, actor_id, data)
      VALUES (lower(hex(randomblob(16))), ?, 'refund_issued', ?, ?)
    `).run(order.id, req.user.id, JSON.stringify({ amountCents, itemId }));
    res.json({ order: orderDetail(order.id, req.user) });
  } catch (err) {
    fail(res, err, 'Refund order error');
  }
});

export default router;
