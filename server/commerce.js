import db from './db.js';

export const FULFILLMENT_METHODS = ['shipping', 'pickup'];

export function normalizeFulfillmentMethod(value) {
  const raw = String(value || 'shipping').trim().toLowerCase().replace(/-/g, '_');
  return ['pickup', 'local_pickup', 'collect'].includes(raw) ? 'pickup' : 'shipping';
}

function platformSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row?.value == null ? fallback : row.value;
}

export function taxSettings() {
  let percent = parseFloat(platformSetting('tax_percent', '0'));
  if (!Number.isFinite(percent)) percent = 0;
  percent = Math.min(Math.max(percent, 0), 30);
  const inclusiveRaw = String(platformSetting('tax_inclusive', '0')).trim().toLowerCase();
  const inclusive = ['1', 'true', 'yes', 'on'].includes(inclusiveRaw);
  const label = String(platformSetting('tax_label', '') || 'Tax').trim() || 'Tax';
  return { percent, rate: percent / 100, inclusive, label };
}

export function calculateTax(taxableCents) {
  const settings = taxSettings();
  const taxable = Math.max(0, Math.round(Number(taxableCents) || 0));
  if (taxable <= 0 || settings.rate <= 0) {
    return { taxCents: 0, breakdown: [], settings };
  }
  const taxCents = settings.inclusive
    ? Math.round((taxable * settings.rate) / (1 + settings.rate))
    : Math.round(taxable * settings.rate);
  const breakdown = taxCents > 0
    ? [{
      label: settings.label,
      rate: settings.percent,
      taxableCents: taxable,
      amountCents: taxCents,
    }]
    : [];
  return { taxCents, breakdown, settings };
}

function sellerIdOf(item) {
  return item?.seller_id || item?.sellerId || '';
}

function shippingFeeCents(item) {
  return Math.max(0, Math.round(Number(item?.shipping_fee_cents) || 0));
}

function freeThresholdCents(item) {
  return Math.max(0, Math.round(Number(item?.free_shipping_threshold_cents) || 0));
}

export function itemAllowsPickup(item) {
  const value = item?.pickup_available ?? item?.pickupAvailable;
  return value == null ? true : !!value;
}

export function calculateShipping(lines, fulfillmentMethod = 'shipping') {
  const method = normalizeFulfillmentMethod(fulfillmentMethod);
  if (method === 'pickup') return { shippingCents: 0, breakdown: [] };

  const sellers = new Map();
  for (const line of lines) {
    const item = line.item || {};
    const sellerId = sellerIdOf(item);
    const subtotal = Math.max(0, Number(line.line_net_cents ?? line.lineNetCents ?? line.line_subtotal_cents ?? line.lineSubtotalCents ?? 0));
    const entry = sellers.get(sellerId) || {
      sellerId,
      merchandiseCents: 0,
      shippingCents: 0,
      freeThresholdCents: 0,
      title: item.title || 'Item',
    };
    entry.merchandiseCents += subtotal;
    entry.shippingCents = Math.max(entry.shippingCents, shippingFeeCents(item));
    entry.freeThresholdCents = Math.max(entry.freeThresholdCents, freeThresholdCents(item));
    sellers.set(sellerId, entry);
  }

  let shippingCents = 0;
  const breakdown = [];
  for (const entry of sellers.values()) {
    const free = entry.shippingCents === 0
      || (entry.freeThresholdCents > 0 && entry.merchandiseCents >= entry.freeThresholdCents);
    const amountCents = free ? 0 : entry.shippingCents;
    shippingCents += amountCents;
    breakdown.push({
      sellerId: entry.sellerId,
      amountCents,
      label: free ? 'Free shipping' : `Shipping - ${entry.title}`,
    });
  }
  return { shippingCents, breakdown };
}

export function quoteTotals(lines, fulfillmentMethod = 'shipping') {
  const merchandiseCents = lines.reduce(
    (sum, line) => sum + Number(line.line_net_cents ?? line.lineNetCents ?? line.line_subtotal_cents ?? line.lineSubtotalCents ?? 0),
    0,
  );
  const shipping = calculateShipping(lines, fulfillmentMethod);
  const tax = calculateTax(merchandiseCents);
  return {
    merchandiseCents,
    shippingCents: shipping.shippingCents,
    taxCents: tax.taxCents,
    totalCents: merchandiseCents + shipping.shippingCents + tax.taxCents,
    shippingBreakdown: shipping.breakdown,
    taxBreakdown: tax.breakdown,
    taxLabel: tax.settings.label,
    taxRate: tax.settings.percent,
    fulfillmentMethod: normalizeFulfillmentMethod(fulfillmentMethod),
  };
}

export function validateFulfillment(items, fulfillmentMethod) {
  const method = normalizeFulfillmentMethod(fulfillmentMethod);
  if (method === 'pickup') {
    const blocked = items.find((item) => !itemAllowsPickup(item));
    if (blocked) return { method, error: `Pickup is not available for ${blocked.title || 'this item'}` };
  }
  return { method, error: null };
}

export function invoiceNumber(orderId) {
  const compact = String(orderId || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `INV-${compact.slice(0, 10) || 'ORDER'}`;
}
