# TradeHub Python backend (`server_py`)

FastAPI replacement for the Node/Express backend. Runs against the **same SQLite
database** and speaks the same HTTP + auth contract, so the React frontend cannot
tell the difference.

## What is ported (Phase 1)

- `GET /api/health`
- All core `POST /api/auth/*` flows: `signup`, `login`, `refresh`, `logout`,
  `forgot-password`, `reset-password`, `verify-email`, `resend-verification`,
  `change-password`, `DELETE /me`
- `GET/PUT /api/auth/me`, `GET /api/auth/search`, `GET /api/auth/batch`,
  `GET /api/auth/:userId/profile`
- Full schema + migration port (`users`, `items`, `transactions`, `wallets`,
  `subscriptions`, `refresh_tokens`, ... all tables/indexes from `server/db.js`)

## Compatibility guarantees

- **JWT**: identical `{ userId }` claim + HS256 + the same `JWT_SECRET`
  default, so tokens issued by one backend verify in the other.
- **Passwords**: bcrypt. New hashes are `$2b$`; existing `$2a$` hashes from the
  Node app still verify.
- **DB file**: defaults to the same `server/tradehub.db` as Node
  (`DB_PATH` overrides). Schema and migrations are byte-for-byte ports.
- **Error shape**: `{ error, details }`, matching what `src/services/client.js`
  already parses.

Run only one backend at a time while they share the file (single-writer).

## Setup

```powershell
cd server_py
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

## Run

```powershell
.venv\Scripts\python -m uvicorn app.main:app --reload --port 3001
```

In production the Node app listens internally and serves the built frontend at
`/Tradehub`; swap `server` for `server_py` behind the same port/process manager.

## Tests

```powershell
.venv\Scripts\pip install -r requirements-dev.txt
.venv\Scripts\python -m pytest -q
```

Tests use an isolated temp DB via `tests/conftest.py`; the real DB is untouched.

## Environment

Reads `.env` in `server_py/` and `server/.env`. `NODE_ENV=production` makes
missing env vars fatal (mirrors `requiredEnv`). `SMTP_HOST` toggles email
"config"; until SMTP is ported, dev mode still returns `devVerifyToken` /
`devResetToken` so flows are testable.

## Roadmap (not ported yet)

1. **Payments** — `wallets`, methods, escrow checkout, dedicated bank transfer,
   saved-card (`charge_authorization`), receipts (the A/B/C sprint targets).
2. **Items / offers / bids / reviews / favorites / cart / search / notifications**.
3. **Chat** — `python-socketio` to keep the `socket.io-client` frontend working.
4. **Subscriptions + Paystack webhooks** — port `server/src/paystack.js`.
5. **Uploads / S3 / images**, **admin**, **referrals**, **promotions**,
   **gift cards**, **payouts**, **disputes/reports/blocking**.
6. **Auth extras** — WebAuthn passkeys, phone OTP, Firebase, social login.
7. **Goals** — ML recommendations/pricing, image/receipt processing in Python.