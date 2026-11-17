import { v4 as uuidv4 } from 'uuid';
import db from './db.js';
import { invoiceNumber } from './commerce.js';

export const SHIPMENT_STATUSES = new Set(['pending', 'shipped', 'in_transit', 'delivered', 'cancelled']);
export const PAID_ORDER_STATUSES = new Set(['processing', 'partially_shipped', 'shipped', 'delivered', 'completed']);

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function notify(userId, type, title, body, data = {}) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, title, body, data)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), userId, type, title, body, JSON.stringify(data));
}

function event(orderId, type, actorId = null, data = {}) {
  db.prepare(`
    INSERT INTO order_events (id, order_id, type, actor_id, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(uuidv4(), orderId, type, actorId, JSON.stringify(data || {}));
}

function loadSnapshot(value) {
  if (value && typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function addressSnapshot(addressId, userId) {
  let address = null;
  if (addressId) {
    address = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(addressId, userId);
    if (!address) throw httpError(400, 'Shipping address not found');
  } else {
    address = db.prepare(
      'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC LIMIT 1'
    ).get(userId);
  }
  if (!address) return { id: null, snapshot: {} };
  return {
    id: address.id,
    snapshot: {
      id: address.id,
      label: address.label || 'Home',
      full_name: address.full_name || '',
      phone: address.phone || '',
      line1: address.line1 || '',
      line2: address.line2 || '',
      city: address.city || '',
      region: address.region || '',
      postal_code: address.postal_code || '',
      country: address.country || 'NG',
    },
  };
}

function trackingUrl(value) {
  const url = String(value || '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    throw httpError(400, 'Tracking URL must start with http:// or https://');
  }
  return url;
}

function itemImage(itemId) {
  return db.prepare('SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1').get(itemId)?.url || '';
}

function firstLineValue(line, snake, camel) {
  return line?.[snake] ?? line?.[camel];
}

export function createOrder({
  buyerId,
  currency,
  lines,
  status = 'processing',
  paymentReference = null,
  paymentMethod = '',
  shippingCents = 0,
  taxCents = 0,
  shippingAddressId = null,
  billingAddressId = null,
  fulfillmentMethod = 'shipping',
  shippingBreakdown = [],
  taxBreakdown = [],
  taxLabel = '',
  taxRate = 0,
}) {
  if (!lines?.length) throw new Error('An order needs at least one line');

  const shipping = addressSnapshot(shippingAddressId, buyerId);
  const billing = billingAddressId ? addressSnapshot(billingAddressId, buyerId) : shipping;

  const subtotalCents = lines.reduce(
    (sum, line) => sum + Number(firstLineValue(line, 'line_subtotal_cents', 'lineSubtotalCents')
      ?? firstLineValue(line, 'line_net_cents', 'lineNetCents')
      ?? 0),
    0,
  );
  const discountCents = lines.reduce(
    (sum, line) => sum + Number(firstLineValue(line, 'line_discount_cents', 'lineDiscountCents') ?? 0),
    0,
  );
  const totalCents = lines.reduce(
    (sum, line) => sum + Number(firstLineValue(line, 'line_net_cents', 'lineNetCents') ?? 0),
    0,
  ) + Number(shippingCents || 0) + Number(taxCents || 0);

  const orderId = uuidv4();
  db.prepare(`
    INSERT INTO orders (
      id, buyer_id, currency, subtotal_cents, shipping_cents, tax_cents,
      discount_cents, total_cents, status, shipping_address_id,
      billing_address_id, shipping_address_json, billing_address_json,
      payment_reference, payment_method, fulfillment_method,
      shipping_breakdown_json, tax_breakdown_json, tax_label, tax_rate
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    buyerId,
    currency,
    subtotalCents,
    Number(shippingCents || 0),
    Number(taxCents || 0),
    discountCents,
    totalCents,
    status,
    shipping.id,
    billing.id,
    JSON.stringify(shipping.snapshot),
    JSON.stringify(billing.snapshot),
    paymentReference,
    paymentMethod || '',
    fulfillmentMethod || 'shipping',
    JSON.stringify(shippingBreakdown || []),
    JSON.stringify(taxBreakdown || []),
    taxLabel || '',
    Number(taxRate || 0),
  );

  const itemStatus = status === 'awaiting_payment' ? 'pending' : 'processing';
  const sellerTitles = new Map();
  for (const line of lines) {
    const item = line.item;
    const quantity = Math.max(1, Number(line.quantity) || 1);
    const lineSubtotal = Number(firstLineValue(line, 'line_subtotal_cents', 'lineSubtotalCents') || 0);
    db.prepare(`
      INSERT INTO order_items (
        id, order_id, item_id, seller_id, quantity, unit_price_cents,
        currency, item_title, item_image, variant_option_id, variant_label, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      orderId,
      item.id,
      item.seller_id,
      quantity,
      lineSubtotal ? Math.round(lineSubtotal / quantity) : 0,
      line.currency || currency,
      item.title || '',
      itemImage(item.id),
      line.variant_option_id || line.variantOptionId || '',
      line.variant_label || line.variantLabel || '',
      itemStatus,
    );
    const titles = sellerTitles.get(item.seller_id) || [];
    titles.push(item.title || 'your item');
    sellerTitles.set(item.seller_id, titles);
  }

  event(orderId, 'order_created', buyerId, {
    status,
    itemCount: lines.length,
    totalCents,
    paymentReference,
  });

  for (const [sellerId, titles] of sellerTitles.entries()) {
    const label = titles.length === 1 ? titles[0] : `${titles.length} items`;
    notify(sellerId, 'sale', 'New order received', `You have a new order for ${label}.`, { orderId });
  }

  return orderId;
}

function orderForUser(orderId, user) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw httpError(404, 'Order not found');
  const sellerIds = db.prepare(
    'SELECT DISTINCT seller_id FROM order_items WHERE order_id = ?'
  ).all(orderId).map((row) => row.seller_id);
  const isBuyer = order.buyer_id === user.id;
  const isSeller = sellerIds.includes(user.id);
  if (!isBuyer && !isSeller && !user.isAdmin) throw httpError(403, 'Not authorized');
  return { order, sellerIds, isBuyer, isSeller };
}

export function listOrders(user, role = 'all') {
  let where = 'o.buyer_id = ?';
  let params = [user.id];
  if (role === 'seller') {
    where = 'EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.seller_id = ?)';
  } else if (role === 'all') {
    where = 'o.buyer_id = ? OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.seller_id = ?)';
    params = [user.id, user.id];
  }

  const rows = db.prepare(`
    SELECT o.*,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
      (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS unit_count,
      (SELECT COUNT(DISTINCT oi.seller_id) FROM order_items oi WHERE oi.order_id = o.id) AS seller_count,
      (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id) AS shipment_count,
      (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.status = 'delivered') AS delivered_shipment_count,
      (SELECT COUNT(*) FROM returns r WHERE r.order_id = o.id AND r.status NOT IN ('cancelled', 'declined')) AS return_count,
      (SELECT COALESCE(NULLIF(oi.item_title, ''), i.title)
         FROM order_items oi LEFT JOIN items i ON i.id = oi.item_id
         WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS primary_title,
      (SELECT COALESCE(NULLIF(oi.item_image, ''), (
          SELECT im.url FROM item_images im WHERE im.item_id = oi.item_id ORDER BY im.sort_order LIMIT 1
       ))
         FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS primary_image
    FROM orders o
    WHERE ${where}
    ORDER BY o.created_at DESC
  `).all(...params);

  return rows.map((row) => ({
    ...row,
    shipping_address: loadSnapshot(row.shipping_address_json),
    tax_breakdown: loadSnapshotArray(row.tax_breakdown_json),
    shipping_breakdown: loadSnapshotArray(row.shipping_breakdown_json),
  }));
}

function loadSnapshotArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function orderDetail(orderId, user) {
  const { order, sellerIds, isBuyer, isSeller } = orderForUser(orderId, user);
  const items = db.prepare(`
    SELECT oi.*,
      COALESCE(NULLIF(oi.item_title, ''), i.title, 'Item') AS title,
      COALESCE(NULLIF(oi.item_image, ''), (
        SELECT im.url FROM item_images im WHERE im.item_id = oi.item_id ORDER BY im.sort_order LIMIT 1
      )) AS image,
      u.name AS seller_name,
      u.store_slug AS seller_store_slug
    FROM order_items oi
    LEFT JOIN items i ON i.id = oi.item_id
    LEFT JOIN users u ON u.id = oi.seller_id
    WHERE oi.order_id = ?
    ORDER BY oi.created_at
  `).all(orderId);
  const shipments = db.prepare(
    'SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at DESC'
  ).all(orderId);
  const events = db.prepare(
    'SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at DESC'
  ).all(orderId).map((row) => ({ ...row, data: loadSnapshot(row.data) }));
  const transactions = db.prepare(`
    SELECT id, item_id, item_title, amount, currency, status, method, variant_label, quantity, refunded_cents, created_at
    FROM transactions WHERE order_id = ? ORDER BY created_at
  `).all(orderId);
  const buyer = db.prepare('SELECT id, name, email, avatar FROM users WHERE id = ?').get(order.buyer_id);

  let shippingAddress = loadSnapshot(order.shipping_address_json);
  if (!shippingAddress.id && order.shipping_address_id) {
    const row = db.prepare('SELECT * FROM addresses WHERE id = ?').get(order.shipping_address_id);
    if (row) {
      shippingAddress = {
        id: row.id,
        label: row.label || 'Home',
        full_name: row.full_name || '',
        phone: row.phone || '',
        line1: row.line1 || '',
        line2: row.line2 || '',
        city: row.city || '',
        region: row.region || '',
        postal_code: row.postal_code || '',
        country: row.country || 'NG',
      };
    }
  }

  return {
    ...order,
    shipping_address: shippingAddress,
    shipping_breakdown: loadSnapshotArray(order.shipping_breakdown_json),
    tax_breakdown: loadSnapshotArray(order.tax_breakdown_json),
    items,
    shipments,
    events,
    transactions,
    buyer,
    seller_ids: sellerIds,
    viewer_role: isBuyer ? 'buyer' : (isSeller ? 'seller' : 'admin'),
  };
}

export function markOrderPaid({ reference = null, orderId = null } = {}) {
  let order = null;
  if (orderId) order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order && reference) {
    order = db.prepare(
      'SELECT * FROM orders WHERE payment_reference = ? ORDER BY created_at DESC LIMIT 1'
    ).get(reference);
  }
  if (!order || ['cancelled', 'refunded'].includes(order.status)) return null;
  if (['awaiting_payment', 'pending'].includes(order.status)) {
    db.prepare("UPDATE orders SET status = 'processing', updated_at = datetime('now') WHERE id = ?").run(order.id);
    db.prepare("UPDATE order_items SET status = 'processing' WHERE order_id = ? AND status = 'pending'").run(order.id);
    event(order.id, 'payment_confirmed', order.buyer_id, {
      paymentReference: reference || order.payment_reference,
    });
  }
  return order.id;
}

export function syncOrderPaymentState(orderId) {
  if (!orderId) return;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return;
  const txns = db.prepare('SELECT status FROM transactions WHERE order_id = ?').all(orderId);
  if (!txns.length) return;
  const statuses = new Set(txns.map((row) => row.status));
  let status = null;
  if (statuses.size === 1 && statuses.has('refunded')) status = 'refunded';
  else if ([...statuses].every((s) => ['completed', 'refunded'].includes(s))) status = 'completed';
  else if (statuses.has('refunded')) status = 'partially_refunded';
  else if ([...statuses].every((s) => ['pending', 'completed'].includes(s))) {
    status = ['pending', 'awaiting_payment'].includes(order.status) ? 'processing' : order.status;
  }
  if (status && status !== order.status) {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, orderId);
    event(orderId, 'order_status_updated', null, { status });
  }
}

function syncShippingStatus(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || ['awaiting_payment', 'pending', 'cancelled', 'refunded', 'partially_refunded', 'completed'].includes(order.status)) {
    return order?.status || null;
  }
  const rows = db.prepare(
    "SELECT status FROM order_items WHERE order_id = ? AND status NOT IN ('cancelled', 'refunded')"
  ).all(orderId);
  if (!rows.length) return order.status;
  const statuses = new Set(rows.map((row) => row.status));
  let status = 'processing';
  if ([...statuses].every((s) => s === 'delivered')) status = 'delivered';
  else if ([...statuses].every((s) => ['shipped', 'delivered'].includes(s))) status = 'shipped';
  else if (statuses.has('shipped') || statuses.has('delivered')) status = 'partially_shipped';
  if (status !== order.status) {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, orderId);
    event(orderId, 'order_status_updated', null, { status });
  }
  return status;
}

export function createShipment(orderId, user, body = {}) {
  const { order, sellerIds } = orderForUser(orderId, user);
  if (!user.isAdmin && !sellerIds.includes(user.id)) {
    throw httpError(403, 'Only the seller can ship this order');
  }
  if (['awaiting_payment', 'pending', 'cancelled', 'refunded'].includes(order.status)) {
    throw httpError(400, 'This order is not ready to ship');
  }

  const sellerId = user.isAdmin ? body.sellerId : user.id;
  if (!sellerIds.includes(sellerId)) throw httpError(400, 'Seller has no items in this order');
  const items = db.prepare(`
    SELECT * FROM order_items WHERE order_id = ? AND seller_id = ?
    AND status NOT IN ('cancelled', 'refunded')
  `).all(orderId, sellerId);
  if (!items.length) throw httpError(400, 'No items available to ship');

  const carrier = String(body.carrier || '').trim();
  if (!carrier) throw httpError(400, 'Carrier is required');
  const trackingNumber = String(body.trackingNumber || '').trim();
  const tracking = trackingUrl(body.trackingUrl);
  const service = String(body.service || '').trim();
  const existing = db.prepare(`
    SELECT * FROM shipments WHERE order_id = ? AND seller_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(orderId, sellerId);

  let shipmentId;
  let eventType;
  if (existing) {
    shipmentId = existing.id;
    eventType = 'shipment_updated';
    db.prepare(`
      UPDATE shipments
      SET carrier = ?, service = ?, tracking_number = ?, tracking_url = ?,
          status = 'shipped', shipped_at = COALESCE(shipped_at, datetime('now')),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(carrier, service, trackingNumber, tracking, shipmentId);
  } else {
    shipmentId = uuidv4();
    eventType = 'shipment_created';
    db.prepare(`
      INSERT INTO shipments (
        id, order_id, seller_id, carrier, service, tracking_number,
        tracking_url, status, shipped_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'shipped', datetime('now'))
    `).run(shipmentId, orderId, sellerId, carrier, service, trackingNumber, tracking);
  }

  db.prepare(`
    UPDATE order_items SET status = 'shipped' WHERE order_id = ? AND seller_id = ?
    AND status NOT IN ('cancelled', 'refunded', 'delivered')
  `).run(orderId, sellerId);
  syncShippingStatus(orderId);
  event(orderId, eventType, user.id, { shipmentId, carrier, trackingNumber, trackingUrl: tracking });
  notify(
    order.buyer_id,
    'order',
    'Your order has shipped',
    `${carrier} is now delivering your order.${trackingNumber ? ` Tracking: ${trackingNumber}.` : ''}`,
    { orderId, shipmentId },
  );
  return orderDetail(orderId, user);
}

export function updateShipment(orderId, shipmentId, user, body = {}) {
  orderForUser(orderId, user);
  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ? AND order_id = ?').get(shipmentId, orderId);
  if (!shipment) throw httpError(404, 'Shipment not found');
  if (!user.isAdmin && shipment.seller_id !== user.id) {
    throw httpError(403, 'Only the seller can update this shipment');
  }

  const status = body.status;
  if (status != null && !SHIPMENT_STATUSES.has(status)) throw httpError(400, 'Invalid shipment status');
  const assignments = [];
  const params = [];
  for (const [field, column] of [
    ['carrier', 'carrier'],
    ['service', 'service'],
    ['trackingNumber', 'tracking_number'],
    ['trackingUrl', 'tracking_url'],
  ]) {
    if (field in body) {
      assignments.push(`${column} = ?`);
      params.push(field === 'trackingUrl'
        ? trackingUrl(body[field])
        : String(body[field] || '').trim());
    }
  }
  if (status) {
    assignments.push('status = ?');
    params.push(status);
    if (['shipped', 'delivered'].includes(status)) {
      assignments.push("shipped_at = COALESCE(shipped_at, datetime('now'))");
    }
    if (status === 'delivered') {
      assignments.push("delivered_at = COALESCE(delivered_at, datetime('now'))");
    }
  }
  assignments.push("updated_at = datetime('now')");
  params.push(shipmentId);
  db.prepare(`UPDATE shipments SET ${assignments.join(', ')} WHERE id = ?`).run(...params);

  if (['shipped', 'in_transit', 'delivered'].includes(status)) {
    db.prepare(`
      UPDATE order_items SET status = ? WHERE order_id = ? AND seller_id = ?
      AND status NOT IN ('cancelled', 'refunded', 'delivered')
    `).run(status === 'delivered' ? 'delivered' : 'shipped', orderId, shipment.seller_id);
  }
  syncShippingStatus(orderId);
  event(orderId, 'shipment_updated', user.id, {
    shipmentId,
    status: status || shipment.status,
  });
  if (status) {
    const order = db.prepare('SELECT buyer_id FROM orders WHERE id = ?').get(orderId);
    notify(order.buyer_id, 'order', 'Shipment update', `Your shipment is now ${status.replace(/_/g, ' ')}.`, {
      orderId,
      shipmentId,
    });
  }
  return orderDetail(orderId, user);
}

export async function confirmDelivery(orderId, user) {
  const { order, isBuyer } = orderForUser(orderId, user);
  if (!isBuyer && !user.isAdmin) throw httpError(403, 'Only the buyer can confirm delivery');
  if (['awaiting_payment', 'pending', 'cancelled', 'refunded'].includes(order.status)) {
    throw httpError(400, 'This order cannot be confirmed yet');
  }
  if (order.status === 'completed') return orderDetail(orderId, user);

  db.prepare(`
    UPDATE shipments SET status = 'delivered',
      shipped_at = COALESCE(shipped_at, datetime('now')),
      delivered_at = COALESCE(delivered_at, datetime('now')),
      updated_at = datetime('now')
    WHERE order_id = ?
  `).run(orderId);
  db.prepare(`
    UPDATE order_items SET status = 'delivered'
    WHERE order_id = ? AND status NOT IN ('cancelled', 'refunded')
  `).run(orderId);
  event(orderId, 'delivery_confirmed', user.id, { confirmedBy: user.id });

  const { finalizeCompleted } = await import('./routes/payments.js');
  const txns = db.prepare('SELECT * FROM transactions WHERE order_id = ?').all(orderId);
  for (const txn of txns) {
    if (txn.status === 'pending') finalizeCompleted(txn);
  }
  syncOrderPaymentState(orderId);
  syncShippingStatus(orderId);

  notify(order.buyer_id, 'order', 'Order delivered', 'You confirmed delivery. Escrow funds have been released to the seller.', { orderId });
  const sellers = db.prepare('SELECT DISTINCT seller_id FROM order_items WHERE order_id = ?').all(orderId);
  for (const row of sellers) {
    notify(row.seller_id, 'sale', 'Order completed', 'The buyer confirmed delivery and the funds are now in your wallet.', { orderId });
  }
  return orderDetail(orderId, user);
}

export function issueInvoice(orderId, user) {
  const { order } = orderForUser(orderId, user);
  const number = order.invoice_number || invoiceNumber(orderId);
  if (!order.invoice_number) {
    db.prepare(`
      UPDATE orders SET invoice_number = ?, invoice_issued_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(number, orderId);
    event(orderId, 'invoice_issued', user.id, { invoiceNumber: number });
  }
  return { ...orderDetail(orderId, user), invoice_number: number };
}
