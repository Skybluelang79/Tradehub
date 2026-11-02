import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_ISSUER = 'TradeHub';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function counterBuffer(counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

export function generateTotp(secret, timestamp = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timestamp / 1000 / step);
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(counterBuffer(counter)).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

export function verifyTotp(secret, token, options = {}) {
  const { window = 1, step = 30, digits = 6 } = options;
  const value = String(token || '').replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(value)) return false;
  if (!secret) return false;

  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = generateTotp(secret, now + offset * step * 1000, step, digits);
    const a = Buffer.from(candidate);
    const b = Buffer.from(value);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function otpauthUrl({ secret, label, issuer = DEFAULT_ISSUER }) {
  const account = label || 'account';
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?${params.toString()}`;
}

export function normalizeBackupCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashBackupCode(code) {
  return crypto.createHash('sha256').update(normalizeBackupCode(code)).digest('hex');
}

export function generateBackupCodes(count = 8) {
  const plain = [];
  const hashed = [];
  for (let i = 0; i < count; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    const code = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plain.push(code);
    hashed.push(hashBackupCode(code));
  }
  return { plain, hashed };
}

export function consumeBackupCode(hashedJson, code) {
  let hashes = [];
  try {
    hashes = JSON.parse(hashedJson || '[]');
  } catch {
    hashes = [];
  }
  const target = hashBackupCode(code);
  const index = hashes.indexOf(target);
  if (index === -1) return null;
  hashes.splice(index, 1);
  return hashes;
}
