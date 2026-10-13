# TradeHub

TradeHub is a local peer-to-peer marketplace with built-in **escrow payments**, **real-time chat**, **multi-item cart checkout**, and an **admin panel**. Buyers pay with store credit, gift cards, card, or Paystack bank transfer; funds are held in escrow until both sides confirm.

## Tech Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite 8, Context API, i18n (EN/DE/ES/FR), PWA |
| Backend | Express 4, Socket.IO, sql.js (SQLite in-browser engine) |
| Payments | Paystack (card + bank transfer), store credit, gift cards |
| Auth | JWT + refresh tokens, bcrypt, optional email verification |
| Ops | Winston logging, node-cron jobs, Docker, Netlify/Render/Railway/Vercel |

## Features

- Browse/search/filter items by category, location, and price
- Favorites, reviews, seller ratings, follow sellers
- Real-time chat with end-to-end encryption option
- Escrow payment flow with auto-release (default 7 days) and abandoned-payment cleanup
- Split/mixed payments: store credit or gift card + card/bank/crypto
- Multi-item cart checkout
- Admin panel: moderation, refunds, disputes, gift card issuance, reporting
- Offline indicator, pull-to-refresh, onboarding tour, cookie consent, light/dark themes
- Geolocation-aware local results

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### 1. Install

```bash
npm install
cd server && npm install && cd ..
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at minimum `JWT_SECRET`, `REFRESH_SECRET`, and `ADMIN_PASSWORD` (generate them with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Without these, the server still runs in demo mode, but **production will refuse to start**.

### 3. Run

```bash
# Terminal 1 - backend API on http://localhost:3001
cd server && npm run dev

# Terminal 2 - frontend on http://localhost:5173
npm run dev
```

The server seeds an admin account on first run:

- Admin: `admin@tradehub.com` / (the value of `ADMIN_PASSWORD`)

The Vite dev server proxies `/api`, `/uploads`, and `/socket.io` to
`http://localhost:3001` by default. To point it at a backend on another host/port
(e.g. the Python backend running with `uvicorn`), set `VITE_PROXY_TARGET`:

```bash
VITE_PROXY_TARGET=http://127.0.0.1:8000 npm run dev
```

## Tests

```bash
# Frontend unit tests (vitest)
npm test

# Backend integration tests (jest + supertest)
cd server
npm test
```

## Deployment

TradeHub ships with configs for **Netlify** (`netlify.toml`), **Render** (`render.yaml`), **Railway** (`railway.json`), **Vercel** (`vercel.json`), and **Docker** (`Dockerfile`, `server/Dockerfile`). In every case you must provide the same env vars as `server/.env.example`.

The alternative **Python (FastAPI) backend** in `server_py/` is deployable on its own via `server_py/Dockerfile`; `render.yaml` includes a `tradehub-api-py` service that builds it. It speaks the same API and uses the same SQLite schema, so run **only one** backend against a given database.

Frontend (`VITE_*`) build-time variables are documented in `.env.example` at the repo root. On Netlify, set them (and every `server/.env.example` var) as **runtime** environment variables — values declared under `[build.environment]` in `netlify.toml` are build-time only and never reach the serverless functions.

### Real-time chat in production

Serverless hosts (Netlify/Vercel Functions) cannot hold WebSocket connections, so chat falls back to REST polling there. To enable real-time, host the API on a long-running process — the Dockerfile, `render.yaml` (Node or `tradehub-api-py`), or `railway.json` — then build the frontend with `VITE_API_URL` pointing at that host and **without** `VITE_DISABLE_SOCKET`. The socket client follows `VITE_API_URL`'s origin automatically.

> **Note:** the sql.js database lives in memory and is flushed to disk. Run a **single API instance** (and add a disk volume on Render/Railway) to avoid lost writes.

### Production checklist

- [ ] Strong, unique `JWT_SECRET`, `REFRESH_SECRET`, `ADMIN_PASSWORD`
- [ ] Real Paystack keys (**secret + public**) and `PAYSTACK_WEBHOOK_SECRET` (webhooks are rejected until configured)
- [ ] `APP_URL` set to your real domain(s) (CORS allowlist)
- [ ] Real SMTP credentials (`SMTP_HOST`/`USER`/`PASS`) for verification/reset emails
- [ ] Termii SMS credentials (`SMS_API_KEY`, `SMS_SENDER`) for phone sign-in
- [ ] Frontend `VITE_*` build vars (see `.env.example`), incl. `VITE_GOOGLE_CLIENT_ID` / `VITE_FACEBOOK_APP_ID` and `VITE_FIREBASE_*`
- [ ] `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` if Facebook login is enabled
- [ ] `OPENAI_API_KEY` if AI features should use an LLM (local fallbacks work without it)
- [ ] On Netlify, set all of the above as **runtime** env vars (netlify.toml build env does not reach functions)
- [ ] `NODE_ENV=production` (Node 22 on Netlify, CI, and Docker)
- [ ] Confirm `GET /api/health` → `integrations` shows the services you expect as `true`

## API

The API is JSON, served under `/api` (e.g. `POST /api/auth/login`, `GET /api/items`, `POST /api/payments/create-intent`). Health check: `GET /api/health`.

## Project Structure

```
src/          # React frontend (pages, components, context providers, services)
server/
  routes/     # Express route modules (auth, items, payments, chat, admin, ...)
  src/        # validation (Zod), rate limiting, logging, error handling, scheduler
  tests/      # Jest + supertest integration tests
  db.js       # sql.js database layer (schema, seeding, persistence)
  index.js    # HTTP server, Socket.IO, graceful shutdown
server_py/    # Alternative FastAPI backend (same API/DB contract) + Dockerfile
```

## Contributing

1. Fork and create a feature branch
2. Run lint (`npm run lint`) and tests (`cd server && npm test`)
3. Open a pull request

## License

Private. All rights reserved.
