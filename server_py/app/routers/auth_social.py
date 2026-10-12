import logging
import os
import uuid

import httpx
from fastapi import APIRouter, Body, HTTPException

from .. import db, security

logger = logging.getLogger("tradehub")

router = APIRouter()

PROFILE_SELECT = "id, name, username, email, avatar, bio, phone, verified, rating, review_count, created_at"


def _provider_profile(provider: str, token: str) -> dict:
    if provider == "google":
        try:
            r = httpx.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": token},
                timeout=10.0,
            )
        except httpx.HTTPError:
            raise HTTPException(status_code=401, detail={"error": "Invalid Google token"})
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail={"error": "Invalid Google token"})
        data = r.json()
        email = (data.get("email") or "").lower()
        if not email:
            raise HTTPException(status_code=401, detail={"error": "Google account has no email"})
        return {
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "avatar": data.get("picture") or "",
            "verified": 1 if data.get("email_verified") else 0,
        }

    app_id = os.environ.get("FACEBOOK_APP_ID", "")
    app_secret = os.environ.get("FACEBOOK_APP_SECRET", "")
    if not app_id or not app_secret:
        raise HTTPException(status_code=503, detail={"error": "Facebook login is not configured"})

    try:
        r = httpx.get(
            "https://graph.facebook.com/debug_token",
            params={"input_token": token, "access_token": f"{app_id}|{app_secret}"},
            timeout=10.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=401, detail={"error": "Invalid Facebook token"})
    if r.status_code != 200 or not (r.json().get("data") or {}).get("is_valid"):
        raise HTTPException(status_code=401, detail={"error": "Invalid Facebook token"})

    try:
        p = httpx.get(
            "https://graph.facebook.com/me",
            params={
                "fields": "id,name,email,picture.type(large)",
                "access_token": token,
            },
            timeout=10.0,
        )
    except httpx.HTTPError:
        raise HTTPException(status_code=401, detail={"error": "Invalid Facebook token"})
    fb = p.json()
    picture = (fb.get("picture") or {}).get("data") or {}
    return {
        "email": (fb.get("email") or "").lower(),
        "name": fb.get("name") or "TradeHub User",
        "avatar": picture.get("url") or "",
        "verified": 1,
    }


def _ensure_subscription(user_id: str) -> None:
    db.run("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)", (user_id,))
    db.run(
        "INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status, trial_end) VALUES (?, ?, 'premium', 'trial', datetime('now', '+90 days'))",
        (str(uuid.uuid4()), user_id),
    )


@router.post("/social")
def social_login(body: dict = Body(...)):
    provider = (body.get("provider") or "").lower()
    token = body.get("token")

    if not token:
        raise HTTPException(status_code=400, detail={"error": "Token required"})
    if provider not in ("google", "facebook"):
        raise HTTPException(status_code=400, detail={"error": "Unsupported provider"})

    profile = _provider_profile(provider, token)
    if not profile["email"]:
        raise HTTPException(status_code=401, detail={"error": "Email is required from social provider"})

    user = db.get("SELECT * FROM users WHERE email = ?", (profile["email"],))
    if not user:
        user_id = str(uuid.uuid4())
        password = security.hash_password(f"{uuid.uuid4()}{security.now_iso()}")
        db.run(
            "INSERT INTO users (id, name, email, password, avatar, verified) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, profile["name"], profile["email"], password, profile["avatar"], profile["verified"]),
        )
        _ensure_subscription(user_id)
        user = db.get("SELECT * FROM users WHERE email = ?", (profile["email"],))

    if user["status"] == "banned":
        raise HTTPException(status_code=403, detail={"error": "Your account has been banned", "reason": user.get("banned_reason") or ""})
    if user["status"] == "suspended":
        raise HTTPException(status_code=403, detail={"error": "Your account has been suspended", "reason": user.get("banned_reason") or ""})

    token_out = security.generate_token(user["id"])
    refresh_token = security.generate_refresh_token(user["id"])
    user.pop("password", None)
    return {"token": token_out, "refreshToken": refresh_token, "user": user}
