from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user

router = APIRouter()


@router.post("/fcm-token")
def save_fcm_token(body: dict = Body(default={}), user: dict = Depends(require_user)):
    token = body.get("token")
    if not token:
        raise HTTPException(status_code=400, detail={"error": "FCM token is required"})

    existing = db.get("SELECT user_id FROM user_settings WHERE user_id = ?", (user["id"],))
    if existing:
        db.run(
            "UPDATE user_settings SET fcm_token = ?, updated_at = datetime('now') WHERE user_id = ?",
            (token, user["id"]),
        )
    else:
        db.run(
            "INSERT INTO user_settings (user_id, fcm_token, created_at, updated_at) "
            "VALUES (?, ?, datetime('now'), datetime('now'))",
            (user["id"], token),
        )
    return {"success": True}


@router.delete("/fcm-token")
def delete_fcm_token(user: dict = Depends(require_user)):
    db.run(
        "UPDATE user_settings SET fcm_token = NULL, updated_at = datetime('now') WHERE user_id = ?",
        (user["id"],),
    )
    return {"success": True}
