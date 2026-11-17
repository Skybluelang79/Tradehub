import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user
from ..notifications import notify
from .payments import refund_txn

logger = logging.getLogger("tradehub")

router = APIRouter()

RETURN_STATUSES = ("requested", "approved", "declined", "completed", "cancelled")

RETURN_SELECT = """
    SELECT r.*, t.item_title, t.amount, t.currency, t.status AS transaction_status,
           b.name AS buyer_name, s.name AS seller_name
    FROM returns r
    LEFT JOIN transactions t ON t.id = r.transaction_id
    LEFT JOIN users b ON b.id = r.buyer_id
    LEFT JOIN users s ON s.id = r.seller_id
"""


def _normalize(row):
    return dict(row)


def _load(return_id):
    row = db.get(RETURN_SELECT + " WHERE r.id = ?", (return_id,))
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Return not found"})
    return row


def _require_party(row, user):
    if not user.get("isAdmin") and user["id"] not in (row["buyer_id"], row["seller_id"]):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})


def _ensure_order(txn):
    order_id = txn.get("order_id") or f"ord_{txn['id']}"
    if not db.get("SELECT 1 FROM orders WHERE id = ?", (order_id,)):
        db.run(
            """
            INSERT INTO orders (id, buyer_id, currency, total_cents, status, payment_reference)
            VALUES (?, ?, ?, ?, 'completed', ?)
            """,
            (
                order_id, txn["buyer_id"], txn.get("currency") or "NGN",
                round(float(txn.get("amount") or 0) * 100), txn.get("paystack_reference") or txn["id"],
            ),
        )
    order_item = db.get(
        "SELECT id FROM order_items WHERE order_id = ? AND item_id = ? AND seller_id = ? "
        "ORDER BY created_at LIMIT 1",
        (order_id, txn["item_id"], txn["seller_id"]),
    )
    if order_item:
        order_item_id = order_item["id"]
    else:
        order_item_id = f"oi_{txn['id']}"
        if not db.get("SELECT 1 FROM order_items WHERE id = ?", (order_item_id,)):
            db.run(
                """
                INSERT INTO order_items (
                  id, order_id, item_id, seller_id, quantity, unit_price_cents,
                  currency, item_title, status
                )
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, 'delivered')
                """,
                (
                    order_item_id, order_id, txn["item_id"], txn["seller_id"],
                    round(float(txn.get("amount") or 0) * 100), txn.get("currency") or "NGN",
                    txn.get("item_title") or "",
                ),
            )
    if not txn.get("order_id"):
        db.run("UPDATE transactions SET order_id = ? WHERE id = ?", (order_id, txn["id"]))
    return order_id, order_item_id


@router.post("", status_code=201)
def create_return(body: dict = Body(...), user: dict = Depends(require_user)):
    txn_id = str(body.get("txnId") or body.get("transactionId") or "").strip()
    reason = str(body.get("reason") or "").strip()
    note = str(body.get("note") or "").strip()
    details = []

    if not txn_id:
        details.append("txnId: Transaction is required")
    if not reason:
        details.append("reason: Reason is required")
    elif len(reason) > 200:
        details.append("reason: String must contain at most 200 character(s)")
    if len(note) > 1000:
        details.append("note: String must contain at most 1000 character(s)")
    if details:
        raise HTTPException(status_code=400, detail={"error": "Validation failed", "details": details})

    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["buyer_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    if txn["status"] not in ("completed", "pending"):
        raise HTTPException(status_code=409, detail={"error": "Only completed orders can be returned"})

    existing = db.get(
        "SELECT 1 FROM returns WHERE transaction_id = ? AND status IN ('requested', 'approved')",
        (txn_id,),
    )
    if existing:
        raise HTTPException(status_code=409, detail={"error": "A return is already open for this order"})

    return_id = str(uuid.uuid4())
    order_id, order_item_id = _ensure_order(txn)
    db.run(
        """
        INSERT INTO returns (id, order_id, order_item_id, buyer_id, seller_id, reason, note,
            status, rma_number, transaction_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?)
        """,
        (
            return_id, order_id, order_item_id, txn["buyer_id"], txn["seller_id"], reason, note,
            f"RMA-{uuid.uuid4().hex[:8].upper()}", txn_id,
        ),
    )
    notify(
        txn["seller_id"], "system", "Return requested",
        f"The buyer requested a return for \"{txn['item_title']}\": {reason}",
        f'{{"returnId":"{return_id}","transactionId":"{txn_id}"}}',
    )
    return {"return": _load(return_id)}


@router.get("")
def list_returns(filter: str = "all", user: dict = Depends(require_user)):
    params = []
    where = []
    if not user.get("isAdmin"):
        if filter == "seller":
            where.append("r.seller_id = ?")
        elif filter == "buyer":
            where.append("r.buyer_id = ?")
        else:
            where.append("(r.buyer_id = ? OR r.seller_id = ?)")
            params.append(user["id"])
        params.append(user["id"])
    where_clause = f" WHERE {' AND '.join(where)}" if where else ""
    rows = db.all(RETURN_SELECT + where_clause + " ORDER BY r.created_at DESC", tuple(params))
    return {"returns": [_normalize(row) for row in rows]}


@router.get("/{return_id}")
def get_return(return_id: str, user: dict = Depends(require_user)):
    row = _load(return_id)
    _require_party(row, user)
    return {"return": _normalize(row)}


def _seller_action(return_id, action, user, note=""):
    row = _load(return_id)
    if not user.get("isAdmin") and user["id"] != row["seller_id"]:
        raise HTTPException(status_code=403, detail={"error": "Only the seller can review this return"})
    if row["status"] != "requested":
        raise HTTPException(status_code=409, detail={"error": "This return can no longer be reviewed"})

    status = "approved" if action == "approve" else "declined"
    db.run(
        "UPDATE returns SET status = ?, resolution_note = ?, updated_at = datetime('now') WHERE id = ?",
        (status, note[:1000], return_id),
    )
    notify(
        row["buyer_id"], "system",
        "Return approved" if action == "approve" else "Return declined",
        note or ("The seller approved your return request." if action == "approve" else "The seller declined your return request."),
        f'{{"returnId":"{return_id}"}}',
    )
    return {"return": _load(return_id)}


@router.post("/{return_id}/approve")
def approve_return(return_id: str, body: dict = Body(default={}), user: dict = Depends(require_user)):
    return _seller_action(return_id, "approve", user, str(body.get("note") or ""))


@router.post("/{return_id}/decline")
def decline_return(return_id: str, body: dict = Body(default={}), user: dict = Depends(require_user)):
    return _seller_action(return_id, "decline", user, str(body.get("note") or ""))


@router.post("/{return_id}/complete")
def complete_return(return_id: str, user: dict = Depends(require_user)):
    row = _load(return_id)
    _require_party(row, user)
    if row["status"] != "approved":
        raise HTTPException(status_code=409, detail={"error": "Only an approved return can be completed"})

    txn = db.get("SELECT * FROM transactions WHERE id = ?", (row["transaction_id"],))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if not refund_txn(txn, {"reason": "return"}):
        raise HTTPException(status_code=409, detail={"error": "This order could not be refunded"})

    db.run(
        """
        UPDATE returns SET status = 'completed', refund_txn_id = ?, resolved_at = datetime('now'),
            updated_at = datetime('now') WHERE id = ?
        """,
        (txn["id"], return_id),
    )
    notify(row["buyer_id"], "payment", "Return refunded", f"Your return for \"{row['item_title']}\" was refunded.")
    notify(row["seller_id"], "system", "Return completed", f"The return for \"{row['item_title']}\" was completed and refunded.")
    return {"return": _load(return_id)}


@router.post("/{return_id}/cancel")
def cancel_return(return_id: str, user: dict = Depends(require_user)):
    row = _load(return_id)
    if not user.get("isAdmin") and user["id"] != row["buyer_id"]:
        raise HTTPException(status_code=403, detail={"error": "Only the buyer can cancel this return"})
    if row["status"] != "requested":
        raise HTTPException(status_code=409, detail={"error": "This return can no longer be cancelled"})
    db.run(
        "UPDATE returns SET status = 'cancelled', updated_at = datetime('now'), resolved_at = datetime('now') WHERE id = ?",
        (return_id,),
    )
    notify(row["seller_id"], "system", "Return cancelled", "The buyer cancelled the return request.")
    return {"return": _load(return_id)}
