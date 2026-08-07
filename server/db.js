import initSqlJs from 'sql.js';
import fs from 'fs';
import { join } from 'path';
import { __dirname } from './src/paths.js';

const DB_PATH = process.env.DB_PATH || join(__dirname, 'tradehub.db');
const USE_BLOB = process.env.NETLIFY === 'true' || process.env.DB_BLOB === 'true' || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

let SQL;
let sqlPromise = null;
const SQL_WASM_CANDIDATES = [
  join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  join(__dirname, '..', '..', '..', 'server', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  join(process.cwd(), 'server', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  join(__dirname, 'sql-wasm.wasm'),
];
let wasmCache = null;
function findWasmIn(dir, depth) {
  if (depth > 4) return null;
  const probe = join(dir, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  try {
    if (fs.existsSync(probe)) return probe;
  } catch {}
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const hit = findWasmIn(join(dir, entry.name), depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}
function locateSqlWasm() {
  if (wasmCache) return wasmCache;
  for (const candidate of SQL_WASM_CANDIDATES) {
    try {
      if (fs.existsSync(candidate)) {
        wasmCache = candidate;
        return candidate;
      }
    } catch {}
  }
  try {
    const found = findWasmIn(process.cwd(), 0);
    if (found) {
      const tmp =
        process.platform === 'win32'
          ? join(process.env.TEMP || process.cwd(), 'sql-wasm.wasm')
          : '/tmp/sql-wasm.wasm';
      fs.copyFileSync(found, tmp);
      wasmCache = tmp;
      return tmp;
    }
  } catch {}
  wasmCache = SQL_WASM_CANDIDATES[0];
  return wasmCache;
}
function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => (file === 'sql-wasm.wasm' ? locateSqlWasm() : file),
    });
  }
  return sqlPromise;
}

let rawDb;
let initialized = false;
let initPromise = null;
let blobStore = null;

let dirty = false;
let flushing = false;
let pendingFlush = Promise.resolve();

function prepare(sql) {
  return {
    get(...params) {
      const stmt = rawDb.prepare(sql);
      if (params.length) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
      let result = null;
      if (stmt.step()) result = stmt.getAsObject();
      stmt.free();
      return result;
    },
    all(...params) {
      const stmt = rawDb.prepare(sql);
      if (params.length) stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
      const results = [];
      while (stmt.step()) results.push(stmt.getAsObject());
      stmt.free();
      return results;
    },
    run(...params) {
      const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      rawDb.run(sql, flat);
      queueFlush();
      return { changes: rawDb.getRowsModified(), lastInsertRowid: rawDb.exec("SELECT last_insert_rowid() as id").pop()?.values[0]?.[0] || 0 };
    },
  };
}

function exec(sql) {
  rawDb.exec(sql);
  queueFlush();
}

function pragma(str) {
  try { rawDb.run(`PRAGMA ${str}`); } catch {}
}

function saveDBFile() {
  try {
    const data = rawDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch {}
}

function transaction(callback) {
  return (...args) => {
    try {
      rawDb.run('BEGIN TRANSACTION');
      const result = callback(...args);
      rawDb.run('COMMIT');
      queueFlush();
      return result;
    } catch (err) {
      try { rawDb.run('ROLLBACK'); } catch {}
      queueFlush();
      throw err;
    }
  };
}

async function getBlobStore() {
  if (blobStore) return blobStore;
  const { getStore } = await import('@netlify/blobs');
  blobStore = getStore({ name: 'tradehub-db' });
  return blobStore;
}

async function persist() {
  const store = await getBlobStore();
  const data = rawDb.export();
  await store.set('tradehub.db', Buffer.from(data));
}

function queueFlush() {
  if (!initialized) return;
  if (!USE_BLOB) {
    saveDBFile();
    return;
  }
  dirty = true;
  if (!flushing) {
    flushing = true;
    pendingFlush = (async () => {
      do {
        dirty = false;
        try {
          await persist();
        } catch (err) {
          dirty = true;
          break;
        }
      } while (dirty);
    })().finally(() => {
      flushing = false;
    });
  }
}

const db = { prepare, exec, pragma, transaction };

function applySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      bio TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      location_lat REAL,
      location_lng REAL,
      location_address TEXT DEFAULT '',
      verified INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      price REAL NOT NULL,
      sale_price REAL,
      sale_ends_at TEXT,
      category TEXT NOT NULL,
      condition TEXT DEFAULT 'good',
      status TEXT DEFAULT 'active',
      seller_id TEXT NOT NULL,
      location_lat REAL,
      location_lng REAL,
      location_address TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      favorites INTEGER DEFAULT 0,
      boosted INTEGER DEFAULT 0,
      boost_expires_at TEXT,
      quantity INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_images (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      last_message TEXT DEFAULT '',
      last_message_time TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      text TEXT NOT NULL,
      encrypted INTEGER DEFAULT 0,
      ciphertext TEXT,
      iv TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      reviewer_id TEXT NOT NULL,
      reviewee_id TEXT NOT NULL,
      item_id TEXT,
      rating INTEGER NOT NULL,
      text TEXT DEFAULT '',
      verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      stripe_payment_method_id TEXT,
      brand TEXT NOT NULL,
      last4 TEXT NOT NULL,
      exp_month INTEGER NOT NULL,
      exp_year INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      item_title TEXT NOT NULL,
      item_image TEXT DEFAULT '',
      amount REAL NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      payment_method_id TEXT,
      status TEXT DEFAULT 'pending',
      stripe_payment_intent_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      read INTEGER DEFAULT 0,
      data TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT DEFAULT '',
      description TEXT DEFAULT '',
      price TEXT DEFAULT '',
      category TEXT DEFAULT '',
      condition TEXT DEFAULT '',
      quantity INTEGER DEFAULT 1,
      sale_price TEXT DEFAULT '',
      variants TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS item_variants (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      name TEXT NOT NULL,
      variant_values TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      resolution TEXT DEFAULT '',
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS blocked_users (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (blocker_id, blocked_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value REAL NOT NULL,
      max_uses INTEGER DEFAULT 0,
      used_count INTEGER DEFAULT 0,
      min_purchase REAL,
      expires_at TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      admin_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details TEXT DEFAULT '{}',
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_reports (
      id TEXT PRIMARY KEY,
      reported_user_id TEXT NOT NULL,
      reporter_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'trial',
      stripe_subscription_id TEXT,
      current_period_start TEXT,
      current_period_end TEXT,
      trial_end TEXT,
      cancelled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      notifications INTEGER DEFAULT 1,
      dark_mode INTEGER DEFAULT 0,
      location_enabled INTEGER DEFAULT 1,
      distance_unit TEXT DEFAULT 'km',
      language TEXT DEFAULT 'English',
      profile_visibility TEXT DEFAULT 'public',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id TEXT PRIMARY KEY,
      credit_cents INTEGER NOT NULL DEFAULT 0,
      available_cents INTEGER NOT NULL DEFAULT 0,
      pending_cents INTEGER NOT NULL DEFAULT 0,
      lifetime_cents INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gift_cards (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      brand_id TEXT,
      card_type TEXT DEFAULT 'digital',
      original_cents INTEGER NOT NULL,
      purchase_cents INTEGER,
      balance_cents INTEGER NOT NULL,
      issued_by TEXT,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      redeemed_by TEXT,
      redeemed_at TEXT,
      expires_at TEXT,
      voided_at TEXT,
      voided_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS gift_card_brands (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      front_image TEXT DEFAULT '',
      back_image TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      fee_cents INTEGER NOT NULL DEFAULT 0,
      method TEXT NOT NULL,
      method_details TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      provider_ref TEXT,
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS carts (
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

    CREATE TABLE IF NOT EXISTS gift_card_designs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      brand_id TEXT,
      image_url TEXT NOT NULL,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
    CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller_id);
    CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at);
    CREATE INDEX IF NOT EXISTS idx_items_price ON items(price);
  `);

  migrate();
}

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrate() {
  ensureColumn('user_settings', 'notif_messages', 'INTEGER DEFAULT 1');
  ensureColumn('user_settings', 'notif_price_drops', 'INTEGER DEFAULT 1');
  ensureColumn('user_settings', 'notif_followers', 'INTEGER DEFAULT 1');
  ensureColumn('user_settings', 'notif_boosts', 'INTEGER DEFAULT 1');
  ensureColumn('users', 'avatar', "TEXT DEFAULT ''");
  ensureColumn('users', 'bio', "TEXT DEFAULT ''");
  ensureColumn('users', 'phone', "TEXT DEFAULT ''");
  ensureColumn('users', 'location_lat', 'REAL');
  ensureColumn('users', 'location_lng', 'REAL');
  ensureColumn('users', 'location_address', "TEXT DEFAULT ''");
  ensureColumn('users', 'is_admin', 'INTEGER DEFAULT 0');
  ensureColumn('transactions', 'method', "TEXT DEFAULT 'card'");
  ensureColumn('transactions', 'provider_ref', "TEXT DEFAULT ''");
  ensureColumn('transactions', 'fee_amount', 'REAL DEFAULT 0');
  ensureColumn('transactions', 'net_amount', 'REAL DEFAULT 0');
  ensureColumn('gift_cards', 'brand_id', 'TEXT');
  ensureColumn('gift_cards', 'card_type', "TEXT DEFAULT 'digital'");
  ensureColumn('gift_cards', 'purchase_cents', 'INTEGER');
  ensureColumn('gift_cards', 'voided_at', 'TEXT');
  ensureColumn('gift_cards', 'voided_by', 'TEXT');
  ensureColumn('users', 'status', "TEXT DEFAULT 'active'");
  ensureColumn('users', 'banned_reason', "TEXT DEFAULT ''");
  ensureColumn('transactions', 'promo_code', "TEXT DEFAULT ''");
  ensureColumn('transactions', 'discount_amount', 'REAL DEFAULT 0');
  ensureColumn('transactions', 'original_amount', 'REAL DEFAULT 0');
  ensureColumn('transactions', 'credit_cents', 'INTEGER DEFAULT 0');

  seedPlatformSettings();
}

function seedPlatformSettings() {
  const defaults = {
    site_name: 'TradeHub',
    support_email: 'support@tradehub.app',
    maintenance_mode: '0',
    platform_fee_percent: '10',
    currency: 'USD',
    terms_url: '',
    privacy_url: '',
    about_text: '',
  };
  for (const [key, value] of Object.entries(defaults)) {
    db.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

async function seedDemoIfNeeded() {
  const existingDemo = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@tradehub.com');
  if (existingDemo) return;

  const bcrypt = await import('bcryptjs');
  const { v4: uuidv4 } = await import('uuid');
  const demoId = uuidv4();
  const hashedPassword = bcrypt.default.hashSync('demo123', 10);
  const avatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex';

  db.prepare(`
    INSERT INTO users (id, name, email, password, avatar, bio, phone, verified, rating, review_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(demoId, 'Alex Morgan', 'demo@tradehub.com', hashedPassword, avatar, 'Passionate collector and tech enthusiast', '+1 (555) 123-4567', 1, 4.8, 23);

  console.log('Demo user seeded: demo@tradehub.com / demo123');
}

export function ensureLoaded() {
  if (initialized) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = (async () => {
    SQL = await getSql();
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    if (!USE_BLOB) {
      rawDb = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
      applySchema();
      await seedDemoIfNeeded();
      initialized = true;
      return;
    }

    let hasData = false;
    try {
      const store = await getBlobStore();
      const data = await store.get('tradehub.db', { type: 'arrayBuffer' });
      if (data && data.byteLength > 0) {
        try { rawDb?.close(); } catch {}
        rawDb = new SQL.Database(new Uint8Array(data));
        hasData = true;
      }
    } catch (err) {
      console.error('Failed to load DB from blob store:', err.message);
    }

    if (!hasData && fs.existsSync(DB_PATH)) {
      rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
      hasData = true;
    }

    if (!rawDb) rawDb = new SQL.Database();

    applySchema();
    if (!hasData) await seedDemoIfNeeded();
    initialized = true;

    if (!hasData) {
      dirty = true;
      try {
        await persist();
        dirty = false;
      } catch (err) {
        console.error('Failed to persist initial DB:', err.message);
      }
    }
  })();

  return initPromise;
}

export async function flushDB() {
  await ensureLoaded();
  if (!USE_BLOB) return;
  if (flushing) {
    await pendingFlush;
  } else if (dirty) {
    dirty = false;
    try {
      await persist();
    } catch (err) {
      dirty = true;
    }
  }
}

export async function exportDatabase() {
  await ensureLoaded();
  return Buffer.from(rawDb.export());
}

export async function replaceDatabase(buffer) {
  await ensureLoaded();
  rawDb.close();
  rawDb = new SQL.Database(new Uint8Array(buffer));
  applySchema();
  initialized = true;
  queueFlush();
}

export default db;
