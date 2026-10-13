FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=3001 \
    DB_PATH=/data/tradehub.db \
    UPLOADS_DIR=/data/uploads

WORKDIR /app

# Install deps first so image layers cache across code changes.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The SQLite database and uploaded files live on this path so a mounted volume
# (Render/Railway/Fly) can persist them across deploys.
RUN mkdir -p /data/uploads

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3001/api/health').status == 200 else 1)" || exit 1

# Shell form so ${PORT} is expanded at runtime; Render/Railway inject PORT.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-3001}"]
