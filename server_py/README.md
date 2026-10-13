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

## Docker / deploy

A `Dockerfile` is provided (build context is this directory). The image serves
`app.main:app` via uvicorn on `$PORT` (default 3001) and keeps the SQLite
database on the volume path `/data/tradehub.db` (override with `DB_PATH`).

```powershell
docker build -t tradehub-api-py server_py
docker run -p 3001:3001 -v tradehub-data:/data `
  -e NODE_ENV=production `
  -e JWT_SECRET=... -e REFRESH_SECRET=... -e ADMIN_PASSWORD=... `
  -e APP_URL=https://your-frontend.example `
  tradehub-api-py
```

`render.yaml` includes a `tradehub-api-py` service that builds this image with
an attached disk. Because the Node and Python backends share the same schema and
SQLite is single-writer, run only one of them against a given database.

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

## Feature parity

The HTTP surface now mirrors the Node backend across:

- **Payments** — wallets, methods, escrow checkout, dedicated bank transfer,
  saved-card, receipts.
- **Items / offers / bids / reviews / favorites / cart / search / notifications**.
- **Chat** — REST plus a `python-socketio` server (`app/realtime.py`) that keeps
  the `socket.io-client` frontend working (messaging, calls, WebRTC relay).
- **Subscriptions + Paystack webhooks** — `app/routers/subscriptions.py`,
  `webhooks.py`, and the hourly jobs in `app/scheduler.py`.
- **Uploads**, **admin**, **referrals**, **promotions**, **gift cards**,
  **payouts**, **disputes/reports/blocking**.
- **Auth extras** — WebAuthn passkeys, phone OTP, Firebase, social login.
- **AI** — listing generation, search parsing, Q&A, price guide, recommendations
  (`app/ai.py`, rule-based fallbacks work offline).
- **Vision** — image statistics/description and receipt parsing under
  `/api/vision` (`app/vision.py`). Image analysis uses Pillow; receipt OCR uses
  Azure Document Intelligence (`prebuilt-receipt`) when configured and falls back
  to regex parsing otherwise. `GET /api/vision/status` reports availability.

Realtime and the background scheduler start automatically at app startup. Set
`RUN_SCHEDULER=false` to disable the scheduler (the test suite does this).

## Not yet ported

- Deep-learning model inference (object detection, embeddings); the vision
  module provides statistics + OCR, not trained-model predictions.