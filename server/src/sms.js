import logger from './logger.js';

// TermiiA (https://termii.com) is the SMS gateway. Credentials come from the
// environment so nothing secret lives in the repo; without them the phone
// sign-in flow cannot deliver anything and says so loudly rather than
// pretending a message was sent.
const API_KEY = process.env.SMS_API_KEY || '';
const SENDER = process.env.SMS_SENDER || 'TradeHub';
const API_URL = 'https://api.termii.com/v1/sms/send';

const IS_PROD = process.env.NODE_ENV === 'production';

export function isSmsConfigured() {
  return Boolean(API_KEY);
}

/**
 * Normalise a user-entered number to the digits-only, country-code form
 * TermiiA expects (e.g. "0803 123 4567" -> "8031234567").
 *
 * Only a leading trunk zero on an 11-digit number is stripped, which is the
 * Nigerian local format. Numbers of any other length are passed through
 * untouched so an international number keeps its own country code.
 */
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  const national = digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits;
  if (national.length < 7 || national.length > 15) return '';

  return national;
}

/** Best-effort pretty form for the UI, derived from the stored digits. */
export function formatPhone(digits) {
  const value = String(digits || '');
  if (value.length === 10) return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`;
  return value;
}

async function postSms({ to, message }) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'api-key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, from: SENDER, message }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.status === 'failed') {
    throw new Error(data?.message || `TermiiA responded with ${res.status}`);
  }

  return data;
}

/**
 * Send a text message. In development without credentials the message is only
 * logged, so the flow stays testable without a paid gateway; production fails
 * loudly instead.
 */
export async function sendSms({ to, message }) {
  if (!isSmsConfigured()) {
    if (IS_PROD) {
      throw new Error('SMS provider is not configured');
    }
    logger.warn(`SMS not sent (no SMS_API_KEY). Would message ${to}: ${message}`);
    return { delivered: false };
  }

  try {
    const data = await postSms({ to, message });
    logger.info(`SMS sent -> ${to}`);
    return { delivered: true, ...data };
  } catch (err) {
    logger.error(`SMS failed to ${to}: ${err.message}`);
    throw err;
  }
}

export function sendOtpSms(to, code) {
  return sendSms({
    to,
    message: `${code} is your TradeHub verification code. It expires in 10 minutes. Do not share it with anyone.`,
  });
}

export default { isSmsConfigured, normalizePhone, formatPhone, sendSms, sendOtpSms };