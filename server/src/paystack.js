import axios from 'axios';
import crypto from 'node:crypto';
import logger from './logger.js';
import { isValidCurrency as isValidAfricanCurrency, isPaystackCurrency as isPaystackChargeable, PAYSTACK_CURRENCIES } from '../../shared/currencies.js';

const BASE_URL = 'https://api.paystack.co';

export const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY
  && !String(process.env.PAYSTACK_SECRET_KEY).includes('placeholder')
  ? process.env.PAYSTACK_SECRET_KEY
  : null;

export const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';

export const isPaystackConfigured = () => !!PAYSTACK_SECRET_KEY;

export const DEFAULT_CURRENCY = process.env.PAYSTACK_CURRENCY || 'NGN';

// The app accepts any of the supported African currencies (see shared/currencies.js);
// Paystack itself can only charge a subset, so those fall back to NGN at checkout.
export const SUPPORTED_CURRENCIES = PAYSTACK_CURRENCIES;

// Every channel Paystack can present on a transaction. Callers pick a subset;
// anything not in this list is dropped before it reaches Paystack so a bad
// value can't make an otherwise valid checkout fail.
export const PAYSTACK_CHANNELS = ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer', 'eft'];

export function normalizeChannels(channels) {
  if (!Array.isArray(channels)) return undefined;
  const cleaned = [...new Set(channels.map((c) => String(c || '').toLowerCase().trim()))]
    .filter((c) => PAYSTACK_CHANNELS.includes(c));
  return cleaned.length ? cleaned : undefined;
}

export function isValidCurrency(c) {
  return isValidAfricanCurrency(c);
}

export function isPaystackCurrency(c) {
  return isPaystackChargeable(c);
}

// Paystack always charges in the minor unit (kobo for NGN, pesewas for GHS,
// and cents for KES/ZAR/USD). Convert a major-unit decimal to the minor unit.
export function toMinorUnits(amount, currency = DEFAULT_CURRENCY) {
  void currency;
  return Math.round(Number(amount) * 100);
}

export function toMajorUnits(minor, currency = DEFAULT_CURRENCY) {
  void currency;
  return Number(((minor || 0) / 100).toFixed(2));
}

function headers() {
  return {
    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Thin, promisified wrapper around the Paystack REST API. Every method returns
// `data` from the { status, message, data } envelope Paystack sends back.
export const paystack = {
  async request(method, path, body) {
    if (!isPaystackConfigured()) {
      const err = new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY.');
      err.status = 503;
      throw err;
    }
    try {
      const res = await axios({ method, url: `${BASE_URL}${path}`, data: body, headers: headers(), timeout: 20000 });
      if (res.data && res.data.status === false) {
        const err = new Error(res.data.message || 'Paystack request failed');
        err.status = 400;
        err.paystack = res.data;
        throw err;
      }
      return res.data.data;
    } catch (err) {
      if (err.status) throw err;
      const msg = err.response?.data?.message || err.message || 'Paystack request failed';
      logger.error(`Paystack ${method} ${path} failed:`, msg);
      const wrapped = new Error(msg);
      wrapped.status = err.response?.status || 502;
      throw wrapped;
    }
  },

  // POST /transaction/initialize - creates a charge and returns an access_code.
  // When `planCode` is supplied Paystack ignores `amount` and charges the plan,
  // auto-creating a subscription on the first successful payment.
  async initializeTransaction({ amountMinor, currency, email, reference, metadata = {}, channels = null, callbackUrl, planCode = null }) {
    const body = {
      amount: amountMinor,
      currency: String(currency || DEFAULT_CURRENCY).toUpperCase(),
      email,
      reference,
      metadata,
      callback_url: callbackUrl || process.env.PAYSTACK_CALLBACK_URL || '',
    };
    const normalized = normalizeChannels(channels);
    if (normalized) body.channels = normalized;
    if (planCode) body.plan = planCode;
    return this.request('POST', '/transaction/initialize', body);
  },

  // POST /charge with a `bank_transfer` object creates a temporary account
  // number tied to this transaction ("Pay with Transfer"). The response carries
  // the account_name / account_number / bank and is never charged to a card.
  async chargeBankTransfer({ amountMinor, currency, email, reference, metadata = {}, expiresAt = null }) {
    return this.request('POST', '/charge', {
      email,
      amount: amountMinor,
      currency: String(currency || DEFAULT_CURRENCY).toUpperCase(),
      reference,
      metadata,
      bank_transfer: { account_expires_at: expiresAt },
    });
  },

  // POST /plan - create (or fetch an existing) recurring billing plan.
  async createPlan({ name, amountMinor, interval = 'monthly', currency }) {
    return this.request('POST', '/plan', {
      name,
      amount: amountMinor,
      interval,
      currency: String(currency || DEFAULT_CURRENCY).toUpperCase(),
    });
  },

  async listPlans() {
    return this.request('GET', '/plan');
  },

  // POST /subscription - subscribe an existing customer (must have a card
  // authorization on file) to a plan.
  async createSubscription({ customer, planCode, authorization = null, startDate = null }) {
    const body = { customer, plan: planCode };
    if (authorization) body.authorization = authorization;
    if (startDate) body.start_date = startDate;
    return this.request('POST', '/subscription', body);
  },

  async disableSubscription({ code, token }) {
    return this.request('POST', '/subscription/disable', { code, token });
  },

  async enableSubscription({ code, token }) {
    return this.request('POST', '/subscription/enable', { code, token });
  },

  // GET /transaction/verify/:reference
  async verifyTransaction(reference) {
    return this.request('GET', `/transaction/verify/${reference}`);
  },

  // POST /transaction/charge_authorization - repeat charge against a saved auth code
  async chargeAuthorization({ amountMinor, currency, email, authorizationCode, reference, metadata = {} }) {
    return this.request('POST', '/transaction/charge_authorization', {
      amount: amountMinor,
      currency: String(currency || DEFAULT_CURRENCY).toUpperCase(),
      email,
      authorization_code: authorizationCode,
      reference,
      metadata,
    });
  },

  // POST /refund - reverse a previous transaction (used to return the nominal
  // ₦1 charge used to tokenize and save a card).
  async refundTransaction(reference) {
    return this.request('POST', '/refund', { transaction: reference });
  },

  // POST /customer - idempotent customer lookup/create
  async getOrCreateCustomer(email, metadata = {}) {
    const existing = await this.request('GET', `/customer/${encodeURIComponent(email)}`).catch(() => null);
    if (existing) return existing;
    return this.request('POST', '/customer', { email, metadata });
  },

  // GET /bank - bank list for transfer recipients
  async listBanks() {
    return this.request('GET', `/bank?country=${process.env.PAYSTACK_BANK_COUNTRY || 'nigeria'}`);
  },

  // POST /transferrecipient - creates a payee for transfers
  async createTransferRecipient({ type, name, accountNumber, bankCode, currency }) {
    return this.request('POST', '/transferrecipient', {
      type: type || 'nuban',
      name,
      account_number: String(accountNumber),
      bank_code: String(bankCode),
      currency: String(currency || DEFAULT_CURRENCY).toUpperCase(),
    });
  },

  // POST /transfer - initiates a payout transfer
  async initiateTransfer({ amountMinor, recipientCode, reference, reason }) {
    return this.request('POST', '/transfer', {
      source: 'balance',
      amount: amountMinor,
      recipient: recipientCode,
      reference,
      reason: reason || 'TradeHub payout',
    });
  },

  // GET /balance - platform balance
  async balance() {
    return this.request('GET', '/balance');
  },
};

// Verifies the HMAC-SHA512 signature Paystack attaches to webhooks.
export function verifyPaystackWebhook(req) {
  const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
  if (!secret) return false;
  const signature = req.headers['x-paystack-signature'];
  if (!signature) return false;
  const body = req.rawBody != null
    ? req.rawBody
    : Buffer.isBuffer(req.body)
      ? req.body
      : (req.body != null ? JSON.stringify(req.body) : '');
  const hash = crypto.createHmac('sha512', secret).update(body).digest('hex');
  return hash === signature;
}