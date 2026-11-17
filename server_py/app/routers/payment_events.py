import json
import uuid

from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..deps import require_user

router = APIRouter()


def log_payment_event(txn_id, user_id, event_type, message="", level="info", details=None, ip_address=None):
    if isinstance(details, str):
        detail_text = details
    else:
        detail_text = json.dumps(details or {}, default=str)
    db.run(
        """
        INSERT INTO payment_events (id, user_id, txn_id, event_type, level, message, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (str(uuid.uuid4()), user_id, txn_id, event_type, level, message or "", detail_text, ip_address),
    )


def _normalize(row):
    row = dict(row)
    try:
        row["details"] = json.loads(row.get("details") or "{}")
    except Exception:
        row["details"] = {}
    return row


@router.get("/events")
def list_payment_events(limit: int = 50, txn_id: str | None = None, user: dict = Depends(require_user)):
    limit = max(1, min(limit, 200))
    params = []
    where = []

    if not user.get("isAdmin"):
        where.append("(e.user_id = ? OR t.buyer_id = ? OR t.seller_id = ?)")
        params.extend([user["id"], user["id"], user["id"]])

    if txn_id:
        where.append("e.txn_id = ?")
        params.append(txn_id)

    where_clause = f" WHERE {' AND '.join(where)}" if where else ""
    rows = db.all(
        """
        SELECT e.*, t.item_title, t.buyer_id, t.seller_id
        FROM payment_events e
        LEFT JOIN transactions t ON t.id = e.txn_id
        """
        + where_clause
        + " ORDER BY e.created_at DESC, e.rowid DESC LIMIT ?",
        tuple([*params, limit]),
    )
    return {"events": [_normalize(row) for row in rows]}


@router.get("/events/transaction/{txn_id}")
def transaction_payment_events(txn_id: str, user: dict = Depends(require_user)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if not user.get("isAdmin") and user["id"] not in (txn["buyer_id"], txn["seller_id"]):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    rows = db.all(
        "SELECT * FROM payment_events WHERE txn_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200",
        (txn_id,),
    )
    return {"events": [_normalize(row) for row in rows]}
