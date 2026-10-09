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
UPLOADS_DIR = os.environ.get("UPLOADS_DIR", str(BASE_DIR.parent / "uploads"))

AZURE_DOC_INTELLIGENCE_ENDPOINT = os.environ.get("AZURE_DOC_INTELLIGENCE_ENDPOINT", "")
AZURE_DOC_INTELLIGENCE_KEY = os.environ.get("AZURE_DOC_INTELLIGENCE_KEY", "")
AZURE_FACE_ENDPOINT = os.environ.get("AZURE_FACE_ENDPOINT", "")
AZURE_FACE_KEY = os.environ.get("AZURE_FACE_KEY", "")
VERIFY_AUTO_APPROVE_MIN_CONFIDENCE = float(os.environ.get("VERIFY_AUTO_APPROVE_MIN_CONFIDENCE", "0.85"))

IS_PRODUCTION = os.environ.get("NODE_ENV") == "production"

PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")
if "placeholder" in PAYSTACK_SECRET_KEY:
    PAYSTACK_SECRET_KEY = ""
PAYSTACK_PUBLIC_KEY = os.environ.get("PAYSTACK_PUBLIC_KEY", "")
PAYSTACK_CURRENCY = os.environ.get("PAYSTACK_CURRENCY", "NGN")
PAYSTACK_CALLBACK_URL = os.environ.get("PAYSTACK_CALLBACK_URL", "")
PAYSTACK_WEBHOOK_SECRET = os.environ.get("PAYSTACK_WEBHOOK_SECRET", "")
PAYSTACK_BANK_TRANSFER_ENABLED = os.environ.get("PAYSTACK_BANK_TRANSFER_ENABLED", "true") != "false"
PAYSTACK_BANK_TRANSFER_EXPIRES_AT = os.environ.get("PAYSTACK_BANK_TRANSFER_EXPIRES_AT", "")
DEMO_MODE = os.environ.get("DEMO_MODE", "false").lower() == "true"


def allowed_origins():
    if os.environ.get("APP_URL"):
        return [s.strip() for s in os.environ["APP_URL"].split(",") if s.strip()]
    if IS_PRODUCTION:
        return []
    return ["http://localhost:5173", "http://localhost:5174", "http://localhost:3001"]


EMAIL_CONFIGURED = bool(os.environ.get("SMTP_HOST"))