import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi import Body

from .. import db
from ..deps import require_user
from ..datetime_util import utc_now
from ..verification import service
from ..verification.checks import ID_TYPES

logger = logging.getLogger("tradehub")

router = APIRouter()

REQUEST_COLUMNS = [
    "r.id",
    "r.user_id",
    "r.id_type",
    "r.id_number",
    "r.id_image_url",
    "r.selfie_url",
    "r.status",
    "r.admin_note",
    "r.created_at",
    "r.reviewed_at",
    "u.name AS user_name",
    "u.email AS user_email",
    "u.avatar AS user_avatar",
    "u.verified AS email_verified",
    "u.identity_verified",
    "r.ai_verdict",
    "r.ai_extracted",
    "r.ai_checks",
]


def get_latest(user_id):
    return db.get(
        f"SELECT {', '.join(REQUEST_COLUMNS)} "
        "FROM verification_requests r LEFT JOIN users u ON u.id = r.user_id "
        "WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 1",
        (user_id,),
    )


def _notify(user_id, title, body):
    db.run(
        "INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), user_id, "verification", title, body),
    )


@router.get("/status")
def verification_status(user: dict = Depends(require_user)):
    user_row = db.get("SELECT identity_verified FROM users WHERE id = ?", (user["id"],))
    return {
        "identityVerified": bool((user_row or {}).get("identity_verified")),
        "request": get_latest(user["id"]) or None,
    }


@router.post("", status_code=201)
def submit_verification(user: dict = Depends(require_user), body: dict = Body(...)):
    id_type = body.get("idType")
    id_number = body.get("idNumber")
    id_image_url = body.get("idImageUrl")
    selfie_url = body.get("selfieUrl")

    if id_type not in ID_TYPES:
        raise HTTPException(status_code=400, detail={"error": f"idType must be one of: {', '.join(ID_TYPES)}"})
    if not str(id_number or "").strip():
        raise HTTPException(status_code=400, detail={"error": "ID number is required"})
    if len(str(id_number).strip()) > 100:
        raise HTTPException(status_code=400, detail={"error": "ID number too long (max 100 characters)"})
    if not str(id_image_url or "").startswith("/uploads/"):
        raise HTTPException(status_code=400, detail={"error": "Please upload a photo of your identification document"})
    if selfie_url and not str(selfie_url).startswith("/uploads/"):
        raise HTTPException(status_code=400, detail={"error": "Invalid selfie upload"})

    user_row = db.get("SELECT identity_verified FROM users WHERE id = ?", (user["id"],))
    if (user_row or {}).get("identity_verified"):
        raise HTTPException(status_code=400, detail={"error": "You are already verified"})

    existing = db.get(
        "SELECT id, status FROM verification_requests WHERE user_id = ? AND status = 'pending'",
        (user["id"],),
    )
    if existing:
        raise HTTPException(status_code=400, detail={"error": "You already have a verification request under review"})

    try:
        result = service.run_verification(
            id_type=id_type,
            id_number=str(id_number).strip(),
            id_image_url=id_image_url,
            selfie_url=selfie_url,
            user_id=user["id"],
        )
        decision = result.decision
    except Exception as err:
        logger.warning("Verification engine error: %s", err)
        result = service.VerificationResult(decision="pending", notes=[str(err)])
        decision = "pending"

    request_id = str(uuid.uuid4())
    status = "approved" if decision == "approved" else "pending"
    reviewed_at = utc_now().strftime("%Y-%m-%d %H:%M:%S") if status == "approved" else None
    db.run(
        "INSERT INTO verification_requests "
        "(id, user_id, id_type, id_number, id_image_url, selfie_url, status, reviewed_at, ai_verdict, ai_extracted, ai_checks) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            request_id,
            user["id"],
            id_type,
            str(id_number).strip(),
            id_image_url,
            selfie_url or None,
            status,
            reviewed_at,
            decision,
            json.dumps(result.extracted, default=str),
            json.dumps(result.checks, default=str),
        ),
    )

    if status == "approved":
        db.run("UPDATE users SET identity_verified = 1 WHERE id = ?", (user["id"],))
        _notify(
            user["id"],
            "Verification Approved",
            "Congratulations! Your seller identity has been verified. You can now list with the Verified Seller badge.",
        )
    else:
        _notify(
            user["id"],
            "Verification Submitted",
            "Your seller verification request has been submitted and is pending review.",
        )

    return {"request": get_latest(user["id"])}