from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..currencies import is_valid_currency
from ..deps import require_user

router = APIRouter()

BOOLEAN_KEYS = [
    "notifications",
    "dark_mode",
    "location_enabled",
    "notif_messages",
    "notif_price_drops",
    "notif_followers",
    "notif_boosts",
]

ALLOWED_KEYS = BOOLEAN_KEYS + ["distance_unit", "language", "profile_visibility", "currency"]

PLATFORM_KEYS = [
    "site_name",
    "support_email",
    "maintenance_mode",
    "platform_fee_percent",
    "currency",
    "terms_url",
    "privacy_url",
    "about_text",
]


def get_user_settings(user_id):
    settings = db.get("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    if not settings:
        db.run("INSERT INTO user_settings (user_id) VALUES (?)", (user_id,))
        settings = db.get("SELECT * FROM user_settings WHERE user_id = ?", (user_id,))
    return settings


@router.get("/platform")
def get_platform_settings():
    placeholders = ", ".join("?" for _ in PLATFORM_KEYS)
    rows = db.all(
        f"SELECT key, value FROM platform_settings WHERE key IN ({placeholders})",
        tuple(PLATFORM_KEYS),
    )
    settings = {row["key"]: row["value"] for row in rows}
    return {"settings": settings}


@router.get("")
def get_settings(user: dict = Depends(require_user)):
    return {"settings": get_user_settings(user["id"])}


@router.put("")
def update_settings(body: dict = Body(default={}), user: dict = Depends(require_user)):
    for key in ALLOWED_KEYS:
        if key in body:
            if key == "currency" and not is_valid_currency(body[key]):
                raise HTTPException(status_code=400, detail={"error": "Unsupported currency"})
            value = (1 if body[key] else 0) if key in BOOLEAN_KEYS else body[key]
            db.run(
                f"UPDATE user_settings SET {key} = ?, updated_at = datetime('now') WHERE user_id = ?",
                (value, user["id"]),
            )

    return {"settings": get_user_settings(user["id"])}
