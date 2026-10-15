import time
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from . import config, db

ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60
REFRESH_TOKEN_TTL = timedelta(days=30)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sql_timestamp(delta=timedelta()):
    # SQLite's datetime('now') renders as "YYYY-MM-DD HH:MM:SS", so expiry
    # columns have to use the same shape or string comparisons against
    # datetime('now') always come out true (the 'T' sorts after the space).
    return (datetime.now(timezone.utc) + delta).strftime("%Y-%m-%d %H:%M:%S")


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(password, hashed):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def generate_token(user_id, **extra):
    payload = {"userId": user_id, "exp": int(time.time()) + ACCESS_TOKEN_TTL_SECONDS}
    payload.update(extra)
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


def decode_token(token):
    return jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])


def generate_refresh_token(user_id):
    token = str(uuid.uuid4())
    expires_at = sql_timestamp(REFRESH_TOKEN_TTL)
    db.run(
        "INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, token, expires_at),
    )
    return token