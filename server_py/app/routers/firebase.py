import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db, security
from ..deps import require_user
from ..email import send_notification_email
from ..firebase import send_push_notification, verify_firebase_token

logger = logging.getLogger("tradehub")

router = APIRouter()

FIREBASE_PROFILE = (
    "id, name, email, avatar, bio, phone, verified, rating, review_count, "
    "location_lat, location_lng, location_address, created_at"
)


@router.post("/signup", status_code=201)
def firebase_signup(body: dict = Body(...)):
    id_token = body.get("idToken")
    name = body.get("name")
    if not id_token:
        raise HTTPException(status_code=400, detail={"error": "Firebase ID token is required"})

    decoded = verify_firebase_token(id_token)
    if not decoded:
        raise HTTPException(status_code=401, detail={"error": "Invalid Firebase token"})

    uid = decoded.get("uid")
    email = (decoded.get("email") or "").lower()

    user = db.get("SELECT * FROM users WHERE firebase_uid = ? OR email = ?", (uid, email))
    if user:
        if not user.get("firebase_uid"):
            db.run(
                "UPDATE users SET firebase_uid = ?, auth_provider = ? WHERE id = ?",
                (uid, "firebase", user["id"]),
            )
        token = security.generate_token(user["id"])
        user_data = db.get(f"SELECT {FIREBASE_PROFILE} FROM users WHERE id = ?", (user["id"],))
        return {"token": token, "user": user_data}

    user_id = str(uuid.uuid4())
    hashed_password = security.hash_password(str(uuid.uuid4()))
    display_name = name or decoded.get("name") or (email.split("@")[0] if email else "User")
    avatar = f"https://api.dicebear.com/7.x/avataaars/svg?seed={display_name.replace(' ', '%20')}"

    db.run(
        """
        INSERT INTO users (id, name, email, password, avatar, verified, firebase_uid, auth_provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'firebase')
        """,
        (user_id, display_name, email, hashed_password, avatar, 1 if decoded.get("email_verified") else 0, uid),
    )
    db.run("INSERT INTO user_settings (user_id) VALUES (?)", (user_id,))
    db.run("INSERT INTO wallets (user_id) VALUES (?)", (user_id,))

    new_user = db.get(f"SELECT {FIREBASE_PROFILE} FROM users WHERE id = ?", (user_id,))
    token = security.generate_token(user_id)
    return {"token": token, "user": new_user}


@router.post("/link")
def firebase_link(user: dict = Depends(require_user), body: dict = Body(...)):
    id_token = body.get("idToken")
    if not id_token:
        raise HTTPException(status_code=400, detail={"error": "Firebase ID token is required"})

    decoded = verify_firebase_token(id_token)
    if not decoded:
        raise HTTPException(status_code=401, detail={"error": "Invalid Firebase token"})

    db.run(
        "UPDATE users SET firebase_uid = ?, auth_provider = ? WHERE id = ?",
        (decoded.get("uid"), "firebase", user["id"]),
    )
    return {"success": True, "message": "Firebase account linked"}


@router.post("/send-email")
def firebase_send_email(user: dict = Depends(require_user), body: dict = Body(...)):
    to = body.get("to")
    subject = body.get("subject")
    text = body.get("body")
    if not to or not subject or not text:
        raise HTTPException(status_code=400, detail={"error": "to, subject, and body are required"})
    send_notification_email(to, subject, text)
    return {"success": True, "message": "Email sent"}


@router.post("/push")
def firebase_push(user: dict = Depends(require_user), body: dict = Body(...)):
    tokens = body.get("tokens")
    title = body.get("title")
    text = body.get("body")
    if not tokens or not title or not text:
        raise HTTPException(status_code=400, detail={"error": "tokens, title, and body are required"})
    result = send_push_notification(
        tokens,
        {"title": title, "body": text, "image": body.get("image"), "data": body.get("data")},
    )
    return {"success": True, "result": result}
