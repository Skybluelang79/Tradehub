from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..deps import require_user

router = APIRouter()


@router.get("")
def list_notifications(user: dict = Depends(require_user)):
    notifications = db.all(
        "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        (user["id"],),
    )
    return {"notifications": notifications}


@router.get("/unread/count")
def unread_count(user: dict = Depends(require_user)):
    row = db.get(
        "SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read = 0",
        (user["id"],),
    )
    return {"count": row["count"] if row else 0}


@router.put("/read-all")
def mark_all_read(user: dict = Depends(require_user)):
    db.run("UPDATE notifications SET read = 1 WHERE user_id = ?", (user["id"],))
    return {"success": True}


@router.put("/{notification_id}/read")
def mark_read(notification_id: str, user: dict = Depends(require_user)):
    result = db.run(
        "UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?",
        (notification_id, user["id"]),
    )
    if not result["changes"]:
        raise HTTPException(status_code=404, detail={"error": "Notification not found"})
    return {"success": True}


@router.delete("/{notification_id}")
def delete_notification(notification_id: str, user: dict = Depends(require_user)):
    db.run(
        "DELETE FROM notifications WHERE id = ? AND user_id = ?",
        (notification_id, user["id"]),
    )
    return {"success": True}


@router.delete("")
def clear_read_notifications(user: dict = Depends(require_user)):
    db.run("DELETE FROM notifications WHERE user_id = ? AND read = 1", (user["id"],))
    return {"success": True}
