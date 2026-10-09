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


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def verify_password(password, hashed):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def generate_token(user_id):
    payload = {"userId": user_id, "exp": int(time.time()) + ACCESS_TOKEN_TTL_SECONDS}
    return jwt.encode(payload, config.JWT_SECRET, algorithm="HS256")


def decode_token(token):
    return jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])


def generate_refresh_token(user_id):
    token = str(uuid.uuid4())
    expires_at = (datetime.now(timezone.utc) + REFRESH_TOKEN_TTL).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    db.run(
        "INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, token, expires_at),
    )
    return token