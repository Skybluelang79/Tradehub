import logging
import uuid
from datetime import timedelta

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from fastapi import Body

from .. import config, db
from ..deps import require_user
from ..security import generate_refresh_token, generate_token, sql_timestamp
from ..sms import is_sms_configured, normalize_phone, send_otp_sms
from ..validation import EMAIL_RE, raise_validation, username_error

logger = logging.getLogger("tradehub")

router = APIRouter()

CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5

DEV_MODE = (not config.IS_PRODUCTION) and (not is_sms_configured())


def _pepper():
    return config.OTP_PEPPER or f"{config.JWT_SECRET}:otp"


def _hash_code(code):
    import hmac
    import hashlib

    return hmac.new(_pepper().encode("utf-8"), str(code).encode("utf-8"), hashlib.sha256).hexdigest()


def _expiry():
    return sql_timestamp(timedelta(minutes=CODE_TTL_MINUTES))


def _generate_code():
    import random

    return f"{random.randint(0, 999999):06d}"


def _issue_code(phone, purpose):
    code = _generate_code()
    db.run(
        "UPDATE phone_otp_codes SET consumed = 1 WHERE phone = ? AND purpose = ? AND consumed = 0",
        (phone, purpose),
    )
    db.run(
        """
        INSERT INTO phone_otp_codes (id, phone, purpose, code_hash, expires_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), phone, purpose, _hash_code(code), _expiry()),
    )
    return code


def _consume_code(phone, code, purpose):
    row = db.get(
        """
        SELECT * FROM phone_otp_codes
        WHERE phone = ? AND purpose = ? AND consumed = 0
        ORDER BY expires_at DESC LIMIT 1
        """,
        (phone, purpose),
    )
    if not row:
        return None
    import datetime

    expires_at = row["expires_at"]
    if isinstance(expires_at, datetime.datetime):
        pass
    else:
        try:
            expires_at = datetime.datetime.strptime(str(expires_at), "%Y-%m-%d %H:%M:%S")
        except Exception:
            try:
                expires_at = datetime.datetime.fromisoformat(str(expires_at).replace("Z", "+00:00").replace("+00:00", ""))
            except Exception:
                expires_at = datetime.datetime.now() - timedelta(days=1)
    if expires_at < datetime.datetime.now():
        db.run("UPDATE phone_otp_codes SET consumed = 1 WHERE id = ?", (row["id"],))
        return None
    if row["attempts"] and int(row["attempts"]) >= MAX_ATTEMPTS:
        db.run("UPDATE phone_otp_codes SET consumed = 1 WHERE id = ?", (row["id"],))
        return None
    if row["code_hash"] != _hash_code(code):
        attempts = (int(row["attempts"]) if row["attempts"] else 0) + 1
        if attempts >= MAX_ATTEMPTS:
            db.run("UPDATE phone_otp_codes SET attempts = ?, consumed = 1 WHERE id = ?", (attempts, row["id"]))
        else:
            db.run("UPDATE phone_otp_codes SET attempts = ? WHERE id = ?", (attempts, row["id"]))
        return None
    db.run("UPDATE phone_otp_codes SET consumed = 1 WHERE id = ?", (row["id"]))
    return row


def _public_user(user):
    if isinstance(user, dict):
        u = dict(user)
        u.pop("password", None)
        return u
    return user


@router.post("/request-code")
async def request_code(body: dict = Body(...)):
    phone = normalize_phone(body.get("phone"))
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "Enter a valid phone number"})
    if not is_sms_configured() and config.IS_PRODUCTION:
        raise HTTPException(status_code=503, detail={"error": "Phone sign-in is not available right now"})
    if not is_sms_configured():
        logger.warning("SMS provider not configured; phone code will only be returned in the response")
    user = db.get("SELECT id FROM users WHERE phone = ? AND phone_verified = 1", (phone,))
    code = _issue_code(phone, "login")
    if user:
        try:
            await send_otp_sms(phone, code)
        except Exception as err:
            logger.warning("Could not deliver phone code to %s: %s", phone, err)
            raise HTTPException(status_code=503, detail={"error": "Could not send the code. Try again shortly."})
    else:
        logger.info("Phone sign-in requested for unregistered number %s", phone)
    payload = {
        "message": "If that number is registered with TradeHub, a verification code is on its way.",
        "expiresInSeconds": CODE_TTL_MINUTES * 60,
    }
    if DEV_MODE:
        payload["devCode"] = code
    return payload


@router.post("/verify")
def verify_code(body: dict = Body(...)):
    phone = normalize_phone(body.get("phone"))
    code = body.get("code")
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "Enter a valid phone number"})
    if not _consume_code(phone, code, "login"):
        raise HTTPException(status_code=401, detail={"error": "That code is wrong or has expired"})
    user = db.get("SELECT * FROM users WHERE phone = ? AND phone_verified = 1", (phone,))
    if not user:
        raise HTTPException(status_code=404, detail={"error": "No TradeHub account uses that number yet"})
    if user["status"] == "banned":
        raise HTTPException(status_code=403, detail={"error": "Your account has been banned", "reason": user.get("banned_reason", "")})
    if user["status"] == "suspended":
        raise HTTPException(status_code=403, detail={"error": "Your account has been suspended", "reason": user.get("banned_reason", "")})
    token = generate_token(user["id"])
    return {"token": token, "refreshToken": generate_refresh_token(user["id"]), "user": _public_user(user)}


@router.post("/signup/request-code")
async def signup_request_code(body: dict = Body(...)):
    phone = normalize_phone(body.get("phone"))
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "Enter a valid phone number"})
    if not is_sms_configured() and config.IS_PRODUCTION:
        raise HTTPException(status_code=503, detail={"error": "Phone sign-up is not available right now"})
    if not is_sms_configured():
        logger.warning("SMS provider not configured; sign-up code will only be returned in the response")
    existing = db.get("SELECT id FROM users WHERE phone = ? AND phone_verified = 1", (phone,))
    if existing:
        raise HTTPException(status_code=409, detail={"error": "That number already has a TradeHub account"})
    code = _issue_code(phone, "signup")
    try:
        await send_otp_sms(phone, code)
    except Exception as err:
        logger.warning("Could not deliver sign-up code to %s: %s", phone, err)
        raise HTTPException(status_code=503, detail={"error": "Could not send the code. Try again shortly."})
    payload = {"message": "Verification code sent to your phone.", "expiresInSeconds": CODE_TTL_MINUTES * 60}
    if DEV_MODE:
        payload["devCode"] = code
    return payload


@router.post("/signup/verify")
def signup_verify(body: dict = Body(...)):
    code = body.get("code")
    name = (body.get("name") or "").strip()
    username = (body.get("username") or "").strip()
    referral_code = body.get("referralCode")
    phone = normalize_phone(body.get("phone"))
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "Enter a valid phone number"})
    if not _consume_code(phone, code, "signup"):
        raise HTTPException(status_code=401, detail={"error": "That code is wrong or has expired"})
    existing = db.get("SELECT id FROM users WHERE phone = ? AND phone_verified = 1", (phone,))
    if existing:
        raise HTTPException(status_code=409, detail={"error": "That number already has a TradeHub account"})
    user_id = str(uuid.uuid4())
    email = f"phone-{phone}@users.tradehub.app"
    if db.get("SELECT id FROM users WHERE email = ?", (email,)):
        raise HTTPException(status_code=409, detail={"error": "That number already has a TradeHub account"})
    avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={encodeURIComponent(name)}"
    unusable_password = bcrypt.hashpw(str(uuid.uuid4()).encode("utf-8") + b"\0" + str(uuid.uuid4()).encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
    db.run(
        "INSERT INTO users (id, name, username, email, password, avatar, phone, phone_verified, auth_provider) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'phone')",
        (user_id, name, username, email, unusable_password, avatar, phone),
    )
    if referral_code:
        logger.warning("Referral apply skipped for code %s (not ported yet)", referral_code)
    db.run("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)", (user_id,))
    db.run(
        "INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status, trial_end) VALUES (?, ?, 'premium', 'trial', datetime('now', '+90 days'))",
        (str(uuid.uuid4()), user_id),
    )
    user = db.get("SELECT id, name, username, email, avatar, bio, phone, verified, rating, review_count, created_at FROM users WHERE id = ?", (user_id,))
    return {"token": generate_token(user_id), "refreshToken": generate_refresh_token(user_id), "user": user}, 201


@router.post("/link")
async def link_phone(user: dict = Depends(require_user), body: dict = Body(...)):
    phone = normalize_phone(body.get("phone"))
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "Enter a valid phone number"})
    owner = db.get("SELECT id FROM users WHERE phone = ?", (phone,))
    if owner and owner["id"] != user["id"]:
        raise HTTPException(status_code=409, detail={"error": "That number is already linked to another account"})
    if not is_sms_configured() and config.IS_PRODUCTION:
        raise HTTPException(status_code=503, detail={"error": "Phone sign-in is not available right now"})
    code = _issue_code(phone, "link")
    try:
        await send_otp_sms(phone, code)
    except Exception as err:
        logger.warning("Could not deliver link code to %s: %s", phone, err)
        raise HTTPException(status_code=503, detail={"error": "Could not send the code. Try again shortly."})
    payload = {"message": "Verification code sent.", "expiresInSeconds": CODE_TTL_MINUTES * 60}
    if DEV_MODE:
        payload["devCode"] = code
    return payload


@router.post("/link/verify")
def link_verify(user: dict = Depends(require_user), body: dict = Body(...)):
    phone = normalize_phone(body.get("phone"))
    code = body.get("code")
    if not phone:
        raise HTTPException(status_code=400, detail={"error": "Enter a valid phone number"})
    if not _consume_code(phone, code, "link"):
        raise HTTPException(status_code=401, detail={"error": "That code is wrong or has expired"})
    owner = db.get("SELECT id FROM users WHERE phone = ?", (phone,))
    if owner and owner["id"] != user["id"]:
        raise HTTPException(status_code=409, detail={"error": "That number is already linked to another account"})
    db.run("UPDATE users SET phone = ?, phone_verified = 1, updated_at = datetime('now') WHERE id = ?", (phone, user["id"]))
    return {"phone": phone, "phoneVerified": True}


@router.delete("/link")
def unlink(user: dict = Depends(require_user)):
    db.run(
        "DELETE FROM phone_otp_codes WHERE phone IN (SELECT phone FROM users WHERE id = ?)",
        (user["id"],),
    )
    db.run("UPDATE users SET phone = '', phone_verified = 0, updated_at = datetime('now') WHERE id = ?", (user["id"],))
    return {"success": True}


@router.get("/status")
def status(user: dict = Depends(require_user)):
    row = db.get("SELECT phone, phone_verified FROM users WHERE id = ?", (user["id"],))
    return {
        "phone": row["phone"] if row and row["phone"] else "",
        "phoneVerified": bool(row["phone_verified"]) if row else False,
        "available": is_sms_configured() or DEV_MODE,
    }


def purge_expired_codes():
    try:
        db.run("DELETE FROM phone_otp_codes WHERE expires_at < datetime('now', '-1 day')")
    except Exception as err:
        logger.warning("OTP cleanup failed: %s", err)
