import initSqlJs from 'sql.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = process.env.DB_PATH || join(__dirname, 'tradehub.db');

let rawDb;

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
      saveDB();
      return { changes: rawDb.getRowsModified(), lastInsertRowid: rawDb.exec("SELECT last_insert_rowid() as id").pop()?.values[0]?.[0] || 0 };
    },
  };
}

function exec(sql) {
  rawDb.exec(sql);
  saveDB();
}

function pragma(str) {
  try { rawDb.run(`PRAGMA ${str}`); } catch {}
}

function saveDB() {
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
      saveDB();
      return result;
    } catch (err) {
      try { rawDb.run('ROLLBACK'); } catch {}
      saveDB();
      throw err;
    }
  };
}

const db = { prepare, exec, pragma, transaction };

const SQL = await initSqlJs();
if (fs.existsSync(DB_PATH)) {
  rawDb = new SQL.Database(fs.readFileSync(DB_PATH));
} else {
  rawDb = new SQL.Database();
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
  CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller_id);
  CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at);
  CREATE INDEX IF NOT EXISTS idx_items_price ON items(price);
`);

// Seed demo user if not exists
const bcryptSalt = 10;
const existingDemo = db.prepare('SELECT id FROM users WHERE email = ?').get('demo@tradehub.com');
if (!existingDemo) {
  const bcryptHash = await import('bcryptjs');
  const { v4: uuidv4 } = await import('uuid');
  const demoId = uuidv4();
  const hashedPassword = bcryptHash.default.hashSync('demo123', 10);
  const avatar = 'https://api.dicebear.com/7.x/avataaars/svg?seed=Alex';

  db.prepare(`
    INSERT INTO users (id, name, email, password, avatar, bio, phone, verified, rating, review_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(demoId, 'Alex Morgan', 'demo@tradehub.com', hashedPassword, avatar, 'Passionate collector and tech enthusiast', '+1 (555) 123-4567', 1, 4.8, 23);

  console.log('Demo user seeded: demo@tradehub.com / demo123');
}

export default db;
