import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_admin, require_user

logger = logging.getLogger("tradehub")

router = APIRouter()

SUPPORT_CATEGORIES = {"account", "payment", "listing", "technical", "safety", "other"}


@router.post("/support", status_code=201)
def create_support_ticket(body: dict = Body(...), user: dict = Depends(require_user)):
    category = body.get("category")
    subject = body.get("subject")
    message = body.get("message")
    contact_email = body.get("contactEmail")

    if not category or category not in SUPPORT_CATEGORIES:
        raise HTTPException(status_code=400, detail={"error": "A valid category is required"})
    if not subject or not str(subject).strip():
        raise HTTPException(status_code=400, detail={"error": "Subject is required"})
    if not message or not str(message).strip():
        raise HTTPException(status_code=400, detail={"error": "Message is required"})
    if len(subject) > 200:
        raise HTTPException(status_code=400, detail={"error": "Subject must be 200 characters or fewer"})
    if len(message) > 5000:
        raise HTTPException(status_code=400, detail={"error": "Message must be 5000 characters or fewer"})

    ticket_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO support_tickets (id, user_id, category, subject, message, contact_email) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (ticket_id, user["id"], category, subject.strip(), message.strip(), (contact_email or "").strip()),
    )
    logger.info("Support ticket %s opened by user %s (%s)", ticket_id, user["id"], category)
    return {"success": True, "id": ticket_id}


@router.get("/support")
def list_support_tickets(user: dict = Depends(require_user)):
    tickets = db.all(
        "SELECT id, category, subject, status, created_at, updated_at "
        "FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
        (user["id"],),
    )
    return {"tickets": tickets}


@router.get("")
def list_own_reports(user: dict = Depends(require_user)):
    reports = db.all(
        "SELECT r.*, i.title as item_title, u.name as reporter_name "
        "FROM reports r "
        "JOIN items i ON r.item_id = i.id "
        "JOIN users u ON r.reporter_id = u.id "
        "WHERE r.reporter_id = ? ORDER BY r.created_at DESC",
        (user["id"],),
    )
    user_reports = db.all(
        "SELECT ur.*, u.name as reporter_name, u2.name as reported_name "
        "FROM user_reports ur "
        "JOIN users u ON ur.reporter_id = u.id "
        "JOIN users u2 ON ur.reported_user_id = u2.id "
        "WHERE ur.reporter_id = ? ORDER BY ur.created_at DESC",
        (user["id"],),
    )
    return {"reports": reports, "userReports": user_reports}


@router.post("", status_code=201)
def create_item_report(body: dict = Body(...), user: dict = Depends(require_user)):
    item_id = body.get("itemId")
    reason = body.get("reason")
    description = body.get("description")
    if not item_id or not reason:
        raise HTTPException(status_code=400, detail={"error": "itemId and reason are required"})

    existing = db.get(
        "SELECT id FROM reports WHERE item_id = ? AND reporter_id = ?",
        (item_id, user["id"]),
    )
    if existing:
        raise HTTPException(status_code=409, detail={"error": "You already reported this item"})

    report_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO reports (id, item_id, reporter_id, reason, description) VALUES (?, ?, ?, ?, ?)",
        (report_id, item_id, user["id"], reason, description or ""),
    )

    report_count = db.get("SELECT COUNT(*) as count FROM reports WHERE item_id = ?", (item_id,))
    if report_count["count"] >= 3:
        db.run("UPDATE items SET status = 'flagged' WHERE id = ?", (item_id,))

    return {"success": True, "id": report_id, "type": "item"}


@router.post("/user", status_code=201)
def create_user_report(body: dict = Body(...), user: dict = Depends(require_user)):
    target_user_id = body.get("userId")
    reason = body.get("reason")
    description = body.get("description")
    if not target_user_id or not reason:
        raise HTTPException(status_code=400, detail={"error": "userId and reason are required"})
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Cannot report yourself"})

    target = db.get("SELECT id FROM users WHERE id = ?", (target_user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})

    existing = db.get(
        "SELECT id FROM user_reports WHERE reported_user_id = ? AND reporter_id = ?",
        (target_user_id, user["id"]),
    )
    if existing:
        raise HTTPException(status_code=409, detail={"error": "You already reported this user"})

    report_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO user_reports (id, reported_user_id, reporter_id, reason, description) "
        "VALUES (?, ?, ?, ?, ?)",
        (report_id, target_user_id, user["id"], reason, description or ""),
    )

    return {"success": True, "id": report_id, "type": "user"}


@router.put("/{report_id}/resolve")
def resolve_report(report_id: str, body: dict = Body(...), user: dict = Depends(require_admin)):
    action = body.get("action")

    report = db.get("SELECT * FROM reports WHERE id = ?", (report_id,))
    report_type = "item"

    if not report:
        report = db.get("SELECT * FROM user_reports WHERE id = ?", (report_id,))
        report_type = "user"

    if not report:
        raise HTTPException(status_code=404, detail={"error": "Report not found"})

    if report_type == "item":
        db.run(
            "UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?",
            (report_id,),
        )
        if action == "remove":
            db.run("UPDATE items SET status = 'removed' WHERE id = ?", (report["item_id"],))
        elif action == "warn":
            db.run("UPDATE items SET status = 'active' WHERE id = ?", (report["item_id"],))
    else:
        db.run(
            "UPDATE user_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?",
            (report_id,),
        )
        if action == "suspend":
            db.run("UPDATE items SET status = 'removed' WHERE seller_id = ?", (report["reported_user_id"],))

    return {"success": True}
