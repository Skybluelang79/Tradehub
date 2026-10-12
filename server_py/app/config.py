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
PAYSTACK_BANK_COUNTRY = os.environ.get("PAYSTACK_BANK_COUNTRY", "nigeria")
DEMO_MODE = os.environ.get("DEMO_MODE", "false").lower() == "true"

APP_URL = os.environ.get("APP_URL", "http://localhost:5173")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")

OTP_PEPPER = os.environ.get("OTP_PEPPER", "")
SMS_API_KEY = os.environ.get("SMS_API_KEY", "")
SMS_SENDER = os.environ.get("SMS_SENDER", "TradeHub")

WEBAUTHN_RP_NAME = os.environ.get("WEBAUTHN_RP_NAME", "TradeHub")
WEBAUTHN_RP_ID = os.environ.get("WEBAUTHN_RP_ID", "")
WEBAUTHN_ORIGINS = os.environ.get("WEBAUTHN_ORIGINS", "")

FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID", "")
FIREBASE_CLIENT_EMAIL = os.environ.get("FIREBASE_CLIENT_EMAIL", "")
FIREBASE_PRIVATE_KEY = os.environ.get("FIREBASE_PRIVATE_KEY", "")
FIREBASE_SERVICE_ACCOUNT = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
FIREBASE_STORAGE = os.environ.get("FIREBASE_STORAGE", "false").lower() == "true"
FIREBASE_STORAGE_BUCKET = os.environ.get("FIREBASE_STORAGE_BUCKET", "")

USE_BLOB = (
    os.environ.get("NETLIFY") == "true"
    or os.environ.get("DB_BLOB") == "true"
    or bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
)

AUTO_RELEASE_DAYS = int(os.environ.get("AUTO_RELEASE_DAYS", "7"))
ABANDON_PAYMENT_HOURS = int(os.environ.get("ABANDON_PAYMENT_HOURS", "24"))
RUN_SCHEDULER = os.environ.get("RUN_SCHEDULER", "true").lower() == "true"


def allowed_origins():
    if os.environ.get("APP_URL"):
        return [s.strip() for s in os.environ["APP_URL"].split(",") if s.strip()]
    if IS_PRODUCTION:
        return []
    return ["http://localhost:5173", "http://localhost:5174", "http://localhost:3001"]


EMAIL_CONFIGURED = bool(os.environ.get("SMTP_HOST"))