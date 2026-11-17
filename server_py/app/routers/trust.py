import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user
from ..notifications import notify

logger = logging.getLogger("tradehub")

router = APIRouter()

SEVERITY_POINTS = {"low": 10, "medium": 25, "high": 50}


def _active_strikes(user_id):
    return db.all(
        """
        SELECT * FROM strikes
        WHERE user_id = ? AND status IN ('active', 'appealed')
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY created_at DESC
        """,
        (user_id,),
    )


def risk_profile(user_id):
    user = db.get("SELECT id, name, rating, review_count, status FROM users WHERE id = ?", (user_id,))
    if not user:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    strikes = _active_strikes(user_id)
    reports = db.get(
        "SELECT COUNT(*) AS count FROM user_reports WHERE reported_user_id = ? AND status = 'pending'",
        (user_id,),
    )["count"]
    score = min(100, sum(int(s["points"] or 0) for s in strikes) + (int(reports) * 10))
    level = "high" if score >= 60 else "medium" if score >= 25 else "low"
    return {
        "userId": user_id,
        "name": user["name"],
        "rating": user["rating"],
        "reviewCount": user["review_count"],
        "accountStatus": user["status"],
        "riskScore": score,
        "riskLevel": level,
        "activeStrikes": len(strikes),
        "pendingReports": int(reports),
    }


def _load_strike(strike_id):
    row = db.get("SELECT * FROM strikes WHERE id = ?", (strike_id,))
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Strike not found"})
    return row


def _load_appeal(appeal_id):
    row = db.get(
        """SELECT a.*, s.reason AS strike_reason, s.severity AS strike_severity
           FROM appeals a JOIN strikes s ON s.id = a.strike_id WHERE a.id = ?""",
        (appeal_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Appeal not found"})
    return row


@router.get("/users/{user_id}")
def public_trust(user_id: str):
    return {"trust": risk_profile(user_id)}


@router.get("/me")
def my_trust(user: dict = Depends(require_user)):
    profile = risk_profile(user["id"])
    profile["strikes"] = [dict(row) for row in db.all(
        "SELECT * FROM strikes WHERE user_id = ? ORDER BY created_at DESC", (user["id"],)
    )]
    profile["appeals"] = [dict(row) for row in db.all(
        "SELECT a.*, s.reason AS strike_reason FROM appeals a JOIN strikes s ON s.id = a.strike_id "
        "WHERE a.user_id = ? ORDER BY a.created_at DESC", (user["id"],)
    )]
    return {"trust": profile}


@router.get("/strikes")
def list_strikes(user: dict = Depends(require_user)):
    if user.get("isAdmin"):
        rows = db.all("SELECT * FROM strikes ORDER BY created_at DESC")
    else:
        rows = db.all("SELECT * FROM strikes WHERE user_id = ? ORDER BY created_at DESC", (user["id"],))
    return {"strikes": [dict(row) for row in rows]}


@router.post("/strikes", status_code=201)
def create_strike(body: dict = Body(...), admin: dict = Depends(require_user)):
    if not admin.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Admin access required"})
    user_id = str(body.get("userId") or "").strip()
    reason = str(body.get("reason") or "").strip()
    severity = str(body.get("severity") or "low").strip().lower()
    description = str(body.get("description") or "").strip()

    if not user_id or not reason:
        raise HTTPException(status_code=400, detail={"error": "userId and reason are required"})
    if severity not in SEVERITY_POINTS:
        raise HTTPException(status_code=400, detail={"error": "severity must be low, medium, or high"})
    if not db.get("SELECT 1 FROM users WHERE id = ?", (user_id,)):
        raise HTTPException(status_code=404, detail={"error": "User not found"})

    try:
        points = int(body.get("points") or SEVERITY_POINTS[severity])
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail={"error": "points must be a number"})
    points = max(0, min(points, 100))

    strike_id = str(uuid.uuid4())
    db.run(
        """
        INSERT INTO strikes (id, user_id, reason, severity, points, description, issued_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            strike_id, user_id, reason, severity, points, description[:2000], admin["id"],
            str(body.get("sourceType") or "")[:50], body.get("sourceId"),
        ),
    )
    notify(user_id, "system", "Account strike", f"A {severity} severity strike was added to your account: {reason}")
    return {"strike": _load_strike(strike_id)}


@router.post("/strikes/{strike_id}/appeal", status_code=201)
def appeal_strike(strike_id: str, body: dict = Body(...), user: dict = Depends(require_user)):
    strike = _load_strike(strike_id)
    if strike["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    if strike["status"] not in ("active", "appealed"):
        raise HTTPException(status_code=409, detail={"error": "This strike can no longer be appealed"})
    existing = db.get(
        "SELECT 1 FROM appeals WHERE strike_id = ? AND status = 'pending'", (strike_id,)
    )
    if existing:
        raise HTTPException(status_code=409, detail={"error": "An appeal is already pending"})
    reason = str(body.get("reason") or "").strip()
    if not reason or len(reason) > 2000:
        raise HTTPException(status_code=400, detail={"error": "A reason up to 2000 characters is required"})

    appeal_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO appeals (id, strike_id, user_id, reason) VALUES (?, ?, ?, ?)",
        (appeal_id, strike_id, user["id"], reason),
    )
    db.run("UPDATE strikes SET status = 'appealed' WHERE id = ?", (strike_id,))
    return {"appeal": _load_appeal(appeal_id)}


@router.get("/appeals")
def list_appeals(user: dict = Depends(require_user)):
    if user.get("isAdmin"):
        rows = db.all(
            "SELECT a.*, s.reason AS strike_reason FROM appeals a JOIN strikes s ON s.id = a.strike_id "
            "ORDER BY a.created_at DESC"
        )
    else:
        rows = db.all(
            "SELECT a.*, s.reason AS strike_reason FROM appeals a JOIN strikes s ON s.id = a.strike_id "
            "WHERE a.user_id = ? ORDER BY a.created_at DESC",
            (user["id"],),
        )
    return {"appeals": [dict(row) for row in rows]}


@router.post("/appeals/{appeal_id}/resolve")
def resolve_appeal(appeal_id: str, body: dict = Body(...), admin: dict = Depends(require_user)):
    if not admin.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Admin access required"})
    appeal = _load_appeal(appeal_id)
    if appeal["status"] != "pending":
        raise HTTPException(status_code=409, detail={"error": "This appeal was already reviewed"})
    action = str(body.get("action") or "").strip().lower()
    if action not in ("approve", "reject"):
        raise HTTPException(status_code=400, detail={"error": "action must be approve or reject"})
    note = str(body.get("note") or "").strip()

    status = "approved" if action == "approve" else "rejected"
    strike_status = "overturned" if action == "approve" else "upheld"
    db.run(
        "UPDATE appeals SET status = ?, reviewed_by = ?, review_note = ?, resolved_at = datetime('now') WHERE id = ?",
        (status, admin["id"], note[:2000], appeal_id),
    )
    db.run(
        "UPDATE strikes SET status = ?, resolved_at = datetime('now') WHERE id = ?",
        (strike_status, appeal["strike_id"]),
    )
    if action == "approve":
        remaining = _active_strikes(appeal["user_id"])
        high_risk = any((s["points"] or 0) >= 50 for s in remaining)
        if not high_risk:
            db.run(
                "UPDATE users SET status = 'active', banned_reason = '' WHERE id = ? AND status = 'suspended'",
                (appeal["user_id"],),
            )
    notify(
        appeal["user_id"], "system",
        "Appeal approved" if action == "approve" else "Appeal rejected",
        note or ("Your appeal was approved and the strike was removed." if action == "approve" else "Your appeal was rejected."),
        f'{{"appealId":"{appeal_id}","strikeId":"{appeal["strike_id"]}"}}',
    )
    return {"appeal": _load_appeal(appeal_id)}
