# Build the React frontend first, then serve it from the Python API so the SPA
# and API share one origin (no CORS or /uploads proxy needed).
FROM node:22-alpine AS frontend

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_BASE=/
RUN npm run build

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=3001 \
    DB_PATH=/data/tradehub.db \
    UPLOADS_DIR=/data/uploads \
    FRONTEND_DIST=/app/dist

WORKDIR /app

# Install deps first so image layers cache across code changes.
COPY server_py/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY server_py/ ./
COPY --from=frontend /app/dist ./dist

# The SQLite database and uploaded files live on this path so a mounted volume
# (Render/Railway/Fly) can persist them across deploys.
RUN mkdir -p /data/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3001/api/health').status == 200 else 1)" || exit 1

# Shell form so ${PORT} is expanded at runtime; Render/Railway inject PORT.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3001}"]
