import base64
import json
import logging
import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import Body

from .. import config, db
from ..deps import require_user
from ..security import generate_refresh_token, generate_token, sql_timestamp
from webauthn import generate_authentication_options, generate_registration_options
from webauthn import options_to_json
from webauthn import verify_authentication_response, verify_registration_response
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    AuthenticatorAttachment,
    ResidentKeyRequirement,
    PublicKeyCredentialDescriptor,
    UserVerificationRequirement,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

logger = logging.getLogger("tradehub")

router = APIRouter()

CHALLENGE_TTL_MINUTES = 5


def _safe_hostname(url):
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url if "://" in url else f"http://{url}")
        return parsed.hostname or "localhost"
    except Exception:
        return "localhost"


def _rp_id():
    if config.WEBAUTHN_RP_ID:
        return config.WEBAUTHN_RP_ID
    return _safe_hostname(config.APP_URL or "http://localhost:5173")


def _rp_name():
    return config.WEBAUTHN_RP_NAME or "TradeHub"


def _origins():
    origins = config.WEBAUTHN_ORIGINS or config.APP_URL or "http://localhost:5173"
    return [o.strip() for o in origins.split(",") if o.strip()]


def _store_challenge(challenge: str, purpose: str, user_id: str | None = None):
    db.run("DELETE FROM webauthn_challenges WHERE expires_at < datetime('now')")
    db.run(
        "INSERT INTO webauthn_challenges (id, challenge, user_id, purpose, expires_at) VALUES (?, ?, ?, ?, ?)",
        (
            str(uuid.uuid4()),
            challenge,
            user_id,
            purpose,
            sql_timestamp(timedelta(minutes=CHALLENGE_TTL_MINUTES)),
        ),
    )


def _take_challenge(challenge: str, purpose: str):
    row = db.get(
        "SELECT * FROM webauthn_challenges WHERE challenge = ? AND purpose = ?",
        (challenge, purpose),
    )
    if not row:
        return None
    db.run("DELETE FROM webauthn_challenges WHERE id = ?", (row["id"],))
    import datetime

    expires_at = row["expires_at"]
    try:
        if isinstance(expires_at, str):
            expires_at = datetime.datetime.strptime(expires_at, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None
    if expires_at < datetime.datetime.now():
        return None
    return row


def _parse_transports(value):
    if not value:
        return None
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
        if isinstance(parsed, list) and parsed:
            return parsed
    except Exception:
        pass
    return None


def _public_credential(row):
    return {
        "id": row["id"],
        "credentialId": row["credential_id"],
        "deviceLabel": row["device_label"] or "This device",
        "backedUp": bool(row["backed_up"]),
        "createdAt": row["created_at"],
        "lastUsedAt": row["last_used_at"] or None,
    }


def _public_user(user):
    if isinstance(user, dict):
        u = dict(user)
        u.pop("password", None)
        return u
    return user


def _block_if_restricted(user):
    if user.get("status") == "banned":
        raise HTTPException(status_code=403, detail={"error": "Your account has been banned", "reason": user.get("banned_reason", "")})
    if user.get("status") == "suspended":
        raise HTTPException(status_code=403, detail={"error": "Your account has been suspended", "reason": user.get("banned_reason", "")})


def _decode_client_data_challenge(client_data_json_b64url: str):
    try:
        data = base64url_to_bytes(client_data_json_b64url)
        parsed = json.loads(data)
        chal = parsed.get("challenge")
        if isinstance(chal, str):
            return chal
    except Exception:
        pass
    return None


def _device_label_from_ua(ua=""):
    ua_str = str(ua or "")
    browser = "Browser"
    if "Edg/" in ua_str:
        browser = "Edge"
    elif "OPR/" in ua_str:
        browser = "Opera"
    elif "Chrome/" in ua_str:
        browser = "Chrome"
    elif "Safari/" in ua_str and "Chrome/" not in ua_str:
        browser = "Safari"
    elif "Firefox/" in ua_str:
        browser = "Firefox"
    platform = ""
    if "Android" in ua_str:
        platform = "Android"
    elif "iPhone" in ua_str or "iPad" in ua_str or "iPod" in ua_str:
        platform = "iOS"
    elif "Windows" in ua_str:
        platform = "Windows"
    elif "Mac OS X" in ua_str:
        platform = "macOS"
    elif "Linux" in ua_str:
        platform = "Linux"
    return f"{browser} on {platform}" if platform else browser


@router.get("/credentials")
def list_credentials(user: dict = Depends(require_user)):
    rows = db.all(
        "SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],),
    )
    return {"credentials": [_public_credential(r) for r in rows]}


@router.delete("/credentials/{credential_id}")
def delete_credential(credential_id: str, user: dict = Depends(require_user)):
    result = db.run(
        "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?",
        (credential_id, user["id"]),
    )
    if not result or result.get("changes") == 0:
        raise HTTPException(status_code=404, detail={"error": "Passkey not found"})
    return {"success": True}


@router.post("/register/options")
async def register_options(user: dict = Depends(require_user), request: Request = None):
    existing = db.all(
        "SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?",
        (user["id"],),
    )
    exclude = []
    for row in existing:
        transports = _parse_transports(row["transports"])
        try:
            exclude.append(
                PublicKeyCredentialDescriptor(
                    id=base64url_to_bytes(row["credential_id"]),
                    transports=transports,
                )
            )
        except Exception:
            pass

    options = generate_registration_options(
        rp_name=_rp_name(),
        rp_id=_rp_id(),
        user_name=user["email"] or user["id"],
        user_display_name=user["name"] or user["email"] or user["id"],
        user_id=user["id"].encode("utf-8"),
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=exclude,
    )
    options_json = json.loads(options_to_json(options))
    challenge = options_json["challenge"]
    _store_challenge(challenge, "register", user["id"])
    return options_json


@router.post("/register/verify")
async def register_verify(user: dict = Depends(require_user), body: dict = Body(...), request: Request = None):
    response = body
    expected_challenge = None
    if response and response.get("response") and response["response"].get("clientDataJSON"):
        expected_challenge = _decode_client_data_challenge(response["response"]["clientDataJSON"])

    challenge_row = expected_challenge and _take_challenge(expected_challenge, "register")
    if not challenge_row or challenge_row["user_id"] != user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Passkey setup expired. Please try again."})

    try:
        verification = verify_registration_response(
            credential=response,
            expected_challenge=challenge_row["challenge"],
            expected_rp_id=_rp_id(),
            expected_origin=_origins()[0] if _origins() else (config.APP_URL or "http://localhost:5173"),
            require_user_verification=True,
        )
    except Exception as err:
        logger.warning("Webauthn registration rejected: %s", err)
        raise HTTPException(status_code=400, detail={"error": "That passkey could not be verified"})

    if not verification.verified:
        raise HTTPException(status_code=400, detail={"error": "That passkey could not be verified"})

    reg_info = verification.registration_info
    cred = reg_info.credential

    try:
        from webauthn.helpers import bytes_to_base64url as b64url

        public_key_b64 = b64url(cred.public_key)
        credential_id_b64 = b64url(cred.id)
    except Exception:
        public_key_b64 = base64.b64encode(cred.public_key, altchars=b"-_").decode("utf-8").rstrip("=")
        credential_id_b64 = base64.b64encode(cred.id, altchars=b"-_").decode("utf-8").rstrip("=")

    db.run(
        """
        INSERT INTO webauthn_credentials
          (id, user_id, credential_id, public_key, counter, transports, device_label, backed_up)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid.uuid4()),
            user["id"],
            credential_id_b64,
            public_key_b64,
            reg_info.sign_count or getattr(cred, "sign_count", 0) or 0,
            json.dumps(getattr(cred, "transports", []) or []),
            _device_label_from_ua((getattr(request, "headers", {}) or {}).get("user-agent") if request else ""),
            1 if getattr(reg_info, "credential_backed_up", False) else 0,
        ),
    )

    row = db.get("SELECT * FROM webauthn_credentials WHERE credential_id = ?", (credential_id_b64,))
    return {"credential": _public_credential(row)}, 201


@router.post("/login/options")
async def login_options(body: dict = Body(default={})):
    allow_credentials = []
    email = body.get("email") if body else None
    if email:
        user = db.get("SELECT id FROM users WHERE email = ?", (email,))
        if user:
            rows = db.all(
                "SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?",
                (user["id"],),
            )
            for row in rows:
                transports = _parse_transports(row["transports"])
                try:
                    allow_credentials.append(
                        PublicKeyCredentialDescriptor(
                            id=base64url_to_bytes(row["credential_id"]),
                            transports=transports,
                        )
                    )
                except Exception:
                    pass

    try:
        options = generate_authentication_options(
            rp_id=_rp_id(),
            allow_credentials=allow_credentials or None,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
    except Exception:
        options = generate_authentication_options(
            rp_id=_rp_id(),
            allow_credentials=allow_credentials or [],
            user_verification=UserVerificationRequirement.REQUIRED,
        )

    options_json = json.loads(options_to_json(options))
    challenge = options_json["challenge"]
    _store_challenge(challenge, "login")
    return options_json


@router.post("/login/verify")
async def login_verify(body: dict = Body(...), request: Request = None):
    response = body
    expected_challenge = None
    if response and response.get("response") and response["response"].get("clientDataJSON"):
        expected_challenge = _decode_client_data_challenge(response["response"]["clientDataJSON"])

    challenge_row = expected_challenge and _take_challenge(expected_challenge, "login")
    if not challenge_row:
        raise HTTPException(status_code=400, detail={"error": "Passkey sign-in expired. Please try again."})

    cred_row = db.get("SELECT * FROM webauthn_credentials WHERE credential_id = ?", (response.get("id"),))
    if not cred_row:
        raise HTTPException(status_code=401, detail={"error": "That passkey is not registered"})

    try:
        from webauthn.helpers import base64url_to_bytes

        public_key = base64url_to_bytes(cred_row["public_key"])
    except Exception:
        try:
            public_key = base64.b64decode(cred_row["public_key"].replace("-", "+").replace("_", "/") + "===")
        except Exception:
            raise HTTPException(status_code=500, detail={"error": "Internal server error"})

    try:
        verification = verify_authentication_response(
            credential=response,
            expected_challenge=challenge_row["challenge"],
            expected_rp_id=_rp_id(),
            expected_origin=_origins()[0] if _origins() else (config.APP_URL or "http://localhost:5173"),
            credential_public_key=public_key,
            credential_current_sign_count=cred_row["counter"] or 0,
            require_user_verification=True,
        )
    except Exception as err:
        logger.warning("Webauthn authentication rejected: %s", err)
        raise HTTPException(status_code=401, detail={"error": "We could not verify your fingerprint"})

    if not verification.verified:
        raise HTTPException(status_code=401, detail={"error": "We could not verify your fingerprint"})

    user = db.get("SELECT * FROM users WHERE id = ?", (cred_row["user_id"],))
    if not user:
        raise HTTPException(status_code=401, detail={"error": "User not found"})
    _block_if_restricted(user)

    auth_info = getattr(verification, "authentication_info", None)
    new_counter = getattr(auth_info, "new_sign_count", None) or getattr(auth_info, "sign_count", None) or (cred_row["counter"] or 0)
    db.run(
        "UPDATE webauthn_credentials SET counter = ?, last_used_at = datetime('now') WHERE id = ?",
        (new_counter, cred_row["id"]),
    )

    token = generate_token(user["id"])
    return {"token": token, "refreshToken": generate_refresh_token(user["id"]), "user": _public_user(user)}
