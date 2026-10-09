from fastapi import Depends, Header, HTTPException

from . import db, security

USER_SELECT = (
    "id, name, username, email, avatar, bio, phone, verified, rating, review_count, "
    "location_lat, location_lng, location_address, status, is_admin AS isAdmin, created_at"
)


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail={"error": "Access token required"})
    parts = authorization.split(" ")
    if len(parts) != 2 or not parts[1]:
        raise HTTPException(status_code=401, detail={"error": "Access token required"})
    try:
        security.decode_token(parts[1])
    except Exception:
        raise HTTPException(status_code=403, detail={"error": "Invalid or expired token"})
    return parts[1]


def current_user(token: str) -> dict:
    decoded = security.decode_token(token)
    user = db.get(f"SELECT {USER_SELECT} FROM users WHERE id = ?", (decoded.get("userId"),))
    if not user:
        raise HTTPException(status_code=401, detail={"error": "User not found"})
    if user["status"] == "banned":
        raise HTTPException(status_code=403, detail={"error": "Your account has been banned"})
    if user["status"] == "suspended":
        raise HTTPException(status_code=403, detail={"error": "Your account has been suspended"})
    return user


def require_user(token: str = Depends(bearer_token)) -> dict:
    return current_user(token)