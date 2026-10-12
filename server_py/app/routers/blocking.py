from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user

router = APIRouter()


@router.post("/block")
def block_user(body: dict = Body(...), user: dict = Depends(require_user)):
    target_user_id = body.get("userId")
    if not target_user_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "Validation failed", "details": ["userId: Required"]},
        )

    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Cannot block yourself"})

    existing = db.get(
        "SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?",
        (user["id"], target_user_id),
    )
    if existing:
        raise HTTPException(status_code=409, detail={"error": "User already blocked"})

    db.run(
        "INSERT INTO blocked_users (blocker_id, blocked_id) VALUES (?, ?)",
        (user["id"], target_user_id),
    )
    return {"success": True, "blocked": True}


@router.post("/unblock")
def unblock_user(body: dict = Body(...), user: dict = Depends(require_user)):
    target_user_id = body.get("userId")
    if not target_user_id:
        raise HTTPException(
            status_code=400,
            detail={"error": "Validation failed", "details": ["userId: Required"]},
        )

    db.run(
        "DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?",
        (user["id"], target_user_id),
    )
    return {"success": True, "blocked": False}


@router.get("/blocked")
def list_blocked(user: dict = Depends(require_user)):
    blocked = db.all(
        "SELECT b.blocked_id as id, u.name, u.avatar, b.created_at "
        "FROM blocked_users b JOIN users u ON b.blocked_id = u.id "
        "WHERE b.blocker_id = ? ORDER BY b.created_at DESC",
        (user["id"],),
    )
    return {"blocked": blocked}


@router.get("/check/{user_id}")
def check_blocked(user_id: str, user: dict = Depends(require_user)):
    blocked = db.get(
        "SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?",
        (user["id"], user_id),
    )
    return {"blocked": bool(blocked)}
