# TradeHub

TradeHub is a local peer-to-peer marketplace with built-in **escrow payments**, **real-time chat**, **multi-item cart checkout**, and an **admin panel**. Buyers pay with store credit, gift cards, card, or Paystack bank transfer; funds are held in escrow until both sides confirm.

## Tech Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite 8, Context API, i18n (EN/DE/ES/FR), PWA |
| Backend | FastAPI (Python 3.12), SQLite (WAL), python-socketio |
| Payments | Paystack (card + bank transfer), store credit, gift cards |
| Auth | JWT + refresh tokens, bcrypt, email verification (SMTP) |
| Ops | Python logging, in-process scheduler, Docker, Render/Railway/Fly |

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

- Python 3.12+
- Node.js 20+ (frontend build)
- npm

### 1. Install

```bash
npm install
pip install -r server_py/requirements.txt
```

### 2. Configure the server

```bash
cp server/.env.example server/.env
```

Edit `server/.env` and set at minimum `JWT_SECRET`, `REFRESH_SECRET`, and `ADMIN_PASSWORD` (generate them with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Without these, the server still runs in demo mode, but **production will refuse to start**.

### 3. Run

```bash
# Terminal 1 - Python API on http://localhost:3001
npm run dev:py

# Terminal 2 - frontend on http://localhost:5173
npm run dev
```

The server seeds an admin account on first run:

- Admin: `admin@tradehub.com` / (the value of `ADMIN_PASSWORD`)

The Vite dev server proxies `/api`, `/uploads`, and `/socket.io` to
`http://localhost:3001` by default. To point it at a backend on another host/port
(e.g. the legacy Express backend), set `VITE_PROXY_TARGET`:

```bash
VITE_PROXY_TARGET=http://127.0.0.1:8000 npm run dev
```

## Tests

```bash
# Frontend unit tests (vitest)
npm test

# Python backend tests (pytest)
npm run test:py
```

## Deployment

The **Python (FastAPI) backend** in `server_py/` is the primary deployment target. The root `Dockerfile` builds the React frontend and the API into one image that serves both from the same origin. `render.yaml`, `railway.json`, and `fly.toml` all deploy that image and keep SQLite + uploads on a persistent `/data` volume.

`server_py/Dockerfile` is the API-only image for split deployments (frontend on a CDN). In that case build the frontend with `VITE_API_URL` pointing at the API and make sure `/uploads/*` is proxied to the same host.

Backend secrets come from the environment; `server/.env.example` documents every variable. `NODE_ENV=production` makes missing secrets fatal. Run **only one** backend instance against a given SQLite file.

### Legacy Node backend

`server/` (Express + sql.js) and the Netlify Function in `netlify.toml` are deprecated. They remain for reference and are not part of the default Docker/Render/Railway/Fly deployment.

### Real-time chat in production

Chat uses `python-socketio` over WebSockets. Host the API on a long-running process (the root `Dockerfile`, Render, Railway, or Fly) so sockets stay connected. If you split the frontend onto a CDN, build it with `VITE_API_URL` pointing at the API and **without** `VITE_DISABLE_SOCKET`; the socket client follows that origin automatically.

> **Note:** SQLite runs in WAL mode. Run a **single API instance** (with the `/data` volume mounted) to avoid lost writes; move to Postgres before scaling horizontally.

### Production checklist

- [ ] Strong, unique `JWT_SECRET`, `REFRESH_SECRET`, `ADMIN_PASSWORD`
- [ ] Real Paystack keys (**secret + public**) and `PAYSTACK_WEBHOOK_SECRET` (webhooks are rejected until configured)
- [ ] `APP_URL` set to your real domain(s) (CORS allowlist)
- [ ] Real SMTP credentials (`SMTP_HOST`/`USER`/`PASS`) for verification/reset emails
- [ ] Termii SMS credentials (`SMS_API_KEY`, `SMS_SENDER`) for phone sign-in
- [ ] Frontend `VITE_*` build vars (see `.env.example`), incl. `VITE_GOOGLE_CLIENT_ID` / `VITE_FACEBOOK_APP_ID` and `VITE_FIREBASE_*`
- [ ] `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` if Facebook login is enabled
- [ ] `OPENAI_API_KEY` if AI features should use an LLM (local fallbacks work without it)
- [ ] `NODE_ENV=production` (the Python backend refuses to start without required secrets)
- [ ] Attach the `/data` volume on Render/Railway/Fly so SQLite and uploads survive deploys
- [ ] Confirm `GET /api/health` returns `{"status":"ok"}`

## API

The API is JSON, served under `/api` (e.g. `POST /api/auth/login`, `GET /api/items`, `POST /api/payments/create-intent`). Health check: `GET /api/health`.

## Project Structure

```
src/          # React frontend (pages, components, context providers, services)
server_py/
  app/routers/    # FastAPI route modules (auth, items, payments, chat, admin, ...)
  app/db.py       # SQLite (WAL) connection + migrations
  app/scheduler.py # escrow auto-release, abandoned payments, search alerts
  app/realtime.py  # python-socketio server
  Dockerfile      # API-only image
server/       # Legacy Express backend (deprecated)
Dockerfile    # Combined frontend + Python API image
```

## Contributing

1. Fork and create a feature branch
2. Run lint (`npm run lint`) and tests (`npm test`, `npm run test:py`)
3. Open a pull request

## License

Private. All rights reserved.
