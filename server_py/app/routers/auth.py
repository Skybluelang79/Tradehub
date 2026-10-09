import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import config, db, security
from ..deps import require_user
from ..validation import EMAIL_RE, username_error, raise_validation

logger = logging.getLogger("tradehub")

router = APIRouter()

LOGIN_PROFILE = "id, name, username, email, avatar, bio, phone, verified, rating, review_count, created_at"


def _iso(delta):
    return (datetime.now(timezone.utc) + delta).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _dev_mode():
    return config.IS_PRODUCTION is False and not config.EMAIL_CONFIGURED


@router.post("/signup", status_code=201)
def signup(body: dict = Body(...)):
    name = (body.get("name") or "").strip()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    username = (body.get("username") or "").strip()
    referral_code = body.get("referralCode") or ""

    details = []
    if not name or len(name) > 100:
        details.append("name: Name is required")
    if not EMAIL_RE.match(email):
        details.append("email: Invalid email address")
    if len(password) < 6 or len(password) > 128:
        details.append("password: Password must be at least 6 characters")
    if username:
        err = username_error(username)
        if err:
            details.append(f"username: {err}")
    if len(referral_code) > 30:
        details.append("referralCode: must be at most 30 characters")
    if details:
        raise_validation(details)

    if db.get("SELECT id FROM users WHERE email = ?", (email,)):
        raise HTTPException(status_code=409, detail={"error": "Email already registered"})

    user_id = str(uuid.uuid4())
    avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={name.replace(' ', '%20')}"
    db.run(
        "INSERT INTO users (id, name, username, email, password, avatar) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, name, username, email, security.hash_password(password), avatar),
    )

    if referral_code:
        logger.warning("Referral apply skipped for code %s (not ported yet)", referral_code)

    verify_token = str(uuid.uuid4())
    db.run(
        "INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, verify_token, _iso(timedelta(days=1))),
    )

    db.run("INSERT OR IGNORE INTO user_settings (user_id) VALUES (?)", (user_id,))
    db.run(
        "INSERT OR IGNORE INTO subscriptions (id, user_id, plan, status, trial_end) VALUES (?, ?, 'premium', 'trial', datetime('now', '+90 days'))",
        (str(uuid.uuid4()), user_id),
    )

    token = security.generate_token(user_id)
    refresh_token = security.generate_refresh_token(user_id)
    user = db.get(f"SELECT {LOGIN_PROFILE} FROM users WHERE id = ?", (user_id,))

    payload = {"token": token, "refreshToken": refresh_token, "user": user}
    if _dev_mode():
        payload["devVerifyToken"] = verify_token
    return payload


@router.post("/login")
def login(body: dict = Body(...)):
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""

    details = []
    if not EMAIL_RE.match(email):
        details.append("email: Invalid email address")
    if not password:
        details.append("password: Password is required")
    if details:
        raise_validation(details)

    user = db.get("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not security.verify_password(password, user["password"]):
        raise HTTPException(status_code=401, detail={"error": "Invalid email or password"})

    if user["status"] == "banned":
        raise HTTPException(status_code=403, detail={"error": "Your account has been banned", "reason": user.get("banned_reason", "")})
    if user["status"] == "suspended":
        raise HTTPException(status_code=403, detail={"error": "Your account has been suspended", "reason": user.get("banned_reason", "")})

    token = security.generate_token(user["id"])
    refresh_token = security.generate_refresh_token(user["id"])
    user.pop("password", None)

    return {"token": token, "refreshToken": refresh_token, "user": user}


@router.post("/refresh")
def refresh(body: dict = Body(...)):
    refresh_token = body.get("refreshToken")
    if not refresh_token:
        raise HTTPException(status_code=400, detail={"error": "Refresh token required"})

    stored = db.get(
        'SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0 AND expires_at > datetime("now")',
        (refresh_token,),
    )
    if not stored:
        raise HTTPException(status_code=401, detail={"error": "Invalid or expired refresh token"})

    db.run("UPDATE refresh_tokens SET revoked = 1 WHERE id = ?", (stored["id"],))
    return {
        "token": security.generate_token(stored["user_id"]),
        "refreshToken": security.generate_refresh_token(stored["user_id"]),
    }


@router.post("/logout")
def logout(user: dict = Depends(require_user), body: dict = Body(default={})):
    refresh_token = body.get("refreshToken")
    if refresh_token:
        db.run("UPDATE refresh_tokens SET revoked = 1 WHERE token = ?", (refresh_token,))
    return {"success": True}


@router.get("/search")
def search_users(q: str = "", page: int = 1, limit: int = 20):
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=400, detail={"error": "Search query must be at least 2 characters"})
    offset = (page - 1) * limit
    users = db.all(
        "SELECT id, name, avatar, bio, verified, rating, review_count FROM users WHERE name LIKE ? ORDER BY rating DESC LIMIT ? OFFSET ?",
        (f"%{q.strip()}%", limit, offset),
    )
    total = db.get("SELECT COUNT(*) as count FROM users WHERE name LIKE ?", (f"%{q.strip()}%",))
    return {"users": users, "total": total["count"]}


@router.get("/batch")
def batch_users(ids: str = ""):
    if not ids:
        raise HTTPException(status_code=400, detail={"error": "ids query parameter required (comma-separated)"})
    id_list = [x for x in ids.split(",") if x]
    if not id_list:
        return {"users": []}
    placeholders = ",".join("?" for _ in id_list)
    users = db.all(
        f"SELECT id, name, avatar, bio, verified, rating, review_count FROM users WHERE id IN ({placeholders})",
        tuple(id_list),
    )
    return {"users": users}


@router.get("/me")
def me(user: dict = Depends(require_user)):
    return {"user": user}


@router.put("/me")
def update_me(user: dict = Depends(require_user), body: dict = Body(...)):
    updates = []
    params = []

    for field in ("name", "username", "bio", "phone", "avatar"):
        if field in body:
            value = body[field]
            if field == "username":
                value = (value or "").strip()
                if value:
                    err = username_error(value)
                    if err:
                        raise_validation([f"username: {err}"])
            updates.append(f"{field} = ?")
            params.append(value)

    location = body.get("location")
    if location is not None:
        if "address" in location:
            updates.append("location_address = ?")
            params.append(location["address"])
        if "lat" in location:
            updates.append("location_lat = ?")
            params.append(location["lat"])
        if "lng" in location:
            updates.append("location_lng = ?")
            params.append(location["lng"])

    if not updates:
        raise HTTPException(status_code=400, detail={"error": "No fields to update"})

    updates.append("updated_at = datetime('now')")
    params.append(user["id"])
    db.run(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", tuple(params))

    updated = db.get("SELECT id, name, username, email, avatar, bio, phone, verified, identity_verified, rating, review_count, location_lat, location_lng, location_address, created_at FROM users WHERE id = ?", (user["id"],))
    return {"user": updated}


@router.put("/change-password")
def change_password(user: dict = Depends(require_user), body: dict = Body(...)):
    current = body.get("currentPassword")
    new_password = body.get("newPassword")
    if not current:
        raise_validation(["currentPassword: Current password is required"])
    if not new_password or len(new_password) < 6:
        raise_validation(["newPassword: New password must be at least 6 characters"])

    stored = db.get("SELECT password FROM users WHERE id = ?", (user["id"],))
    if not security.verify_password(current, stored["password"]):
        raise HTTPException(status_code=401, detail={"error": "Current password is incorrect"})

    db.run("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?", (security.hash_password(new_password), user["id"]))
    return {"message": "Password updated"}


@router.post("/forgot-password")
def forgot_password(body: dict = Body(...)):
    email = (body.get("email") or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise_validation(["email: Invalid email address"])

    if not config.EMAIL_CONFIGURED and not _dev_mode():
        raise HTTPException(status_code=503, detail={"error": "Password reset email is not configured"})

    dev_token = None
    user = db.get("SELECT id FROM users WHERE email = ?", (email,))
    if user:
        token = str(uuid.uuid4())
        db.run(
            "INSERT INTO password_resets (id, email, token, expires_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), email, token, _iso(timedelta(hours=1))),
        )
        logger.warning("Password reset email skipped (SMTP not ported yet) for %s", email)
        if _dev_mode():
            dev_token = token

    result = {"message": "If an account exists with this email, you will receive reset instructions"}
    if dev_token:
        result["devResetToken"] = dev_token
    return result


@router.post("/reset-password")
def reset_password(body: dict = Body(...)):
    token = body.get("token") or ""
    new_password = body.get("password") or ""
    if not token:
        raise_validation(["token: Token is required"])
    if not new_password or len(new_password) < 6:
        raise_validation(["password: Password must be at least 6 characters"])

    reset = db.get(
        'SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
        (token,),
    )
    if not reset:
        raise HTTPException(status_code=400, detail={"error": "Invalid or expired reset token"})

    db.run('UPDATE users SET password = ?, updated_at = datetime("now") WHERE email = ?', (security.hash_password(new_password), reset["email"]))
    db.run("UPDATE password_resets SET used = 1 WHERE id = ?", (reset["id"],))
    return {"message": "Password reset successfully"}


@router.post("/verify-email")
def verify_email(body: dict = Body(...)):
    token = body.get("token") or ""
    if not token:
        raise HTTPException(status_code=400, detail={"error": "Token required"})

    verification = db.get(
        'SELECT * FROM email_verifications WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
        (token,),
    )
    if not verification:
        raise HTTPException(status_code=400, detail={"error": "Invalid or expired verification token"})

    db.run("UPDATE users SET verified = 1 WHERE id = ?", (verification["user_id"],))
    db.run("UPDATE email_verifications SET used = 1 WHERE id = ?", (verification["id"],))
    return {"message": "Email verified successfully"}


@router.delete("/me")
def delete_me(user: dict = Depends(require_user), body: dict = Body(...)):
    password = body.get("password")
    if not password:
        raise HTTPException(status_code=400, detail={"error": "Password required to delete account"})

    stored = db.get("SELECT password FROM users WHERE id = ?", (user["id"],))
    if not security.verify_password(password, stored["password"]):
        raise HTTPException(status_code=401, detail={"error": "Invalid password"})

    user_id = user["id"]
    db.run("DELETE FROM refresh_tokens WHERE user_id = ?", (user_id,))
    db.run("DELETE FROM notifications WHERE user_id = ?", (user_id,))
    db.run("DELETE FROM favorites WHERE user_id = ?", (user_id,))
    db.run("DELETE FROM item_images WHERE item_id IN (SELECT id FROM items WHERE seller_id = ?)", (user_id,))
    db.run("DELETE FROM items WHERE seller_id = ?", (user_id,))
    db.run("DELETE FROM conversations WHERE buyer_id = ? OR seller_id = ?", (user_id, user_id))
    db.run("DELETE FROM reviews WHERE reviewer_id = ? OR reviewee_id = ?", (user_id, user_id))
    db.run("DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?", (user_id, user_id))
    db.run("DELETE FROM payment_methods WHERE user_id = ?", (user_id,))
    db.run("DELETE FROM templates WHERE user_id = ?", (user_id,))
    db.run("DELETE FROM user_settings WHERE user_id = ?", (user_id,))
    db.run("DELETE FROM users WHERE id = ?", (user_id,))

    return {"success": True, "message": "Account permanently deleted"}


@router.post("/resend-verification")
def resend_verification(user: dict = Depends(require_user)):
    row = db.get("SELECT id, email, verified FROM users WHERE id = ?", (user["id"],))
    if row["verified"]:
        return {"message": "Email already verified"}

    if not config.EMAIL_CONFIGURED and not _dev_mode():
        raise HTTPException(status_code=503, detail={"error": "Verification email is not configured"})

    token = str(uuid.uuid4())
    db.run(
        "INSERT INTO email_verifications (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), row["id"], token, _iso(timedelta(days=1))),
    )
    logger.warning("Verification email skipped (SMTP not ported yet) for %s", row["email"])
    return {"message": "Verification email sent"}


@router.get("/{user_id}/profile")
def get_profile(user_id: str):
    user = db.get("SELECT id, name, avatar, bio, verified, identity_verified, rating, review_count, created_at FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(status_code=404, detail={"error": "User not found"})

    stats = db.get(
        """
        SELECT
          COUNT(*) as total_listings,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_listings,
          SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_listings
        FROM items WHERE seller_id = ?
        """,
        (user_id,),
    )
    return {"user": user, "stats": stats}