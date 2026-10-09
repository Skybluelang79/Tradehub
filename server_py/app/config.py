import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / "server" / ".env")


def _env(name, default=""):
    value = os.environ.get(name)
    if value:
        return value
    if os.environ.get("NODE_ENV") == "production":
        raise RuntimeError(f"Missing required environment variable: {name}")
    return default


JWT_SECRET = _env("JWT_SECRET", "tradehub-secret-key-change-in-production-2026")
REFRESH_SECRET = _env("REFRESH_SECRET", "tradehub-refresh-secret-change-in-production-2026")
DB_PATH = _env("DB_PATH", str(BASE_DIR.parent / "server" / "tradehub.db"))

IS_PRODUCTION = os.environ.get("NODE_ENV") == "production"


def allowed_origins():
    if os.environ.get("APP_URL"):
        return [s.strip() for s in os.environ["APP_URL"].split(",") if s.strip()]
    if IS_PRODUCTION:
        return []
    return ["http://localhost:5173", "http://localhost:5174", "http://localhost:3001"]


EMAIL_CONFIGURED = bool(os.environ.get("SMTP_HOST"))