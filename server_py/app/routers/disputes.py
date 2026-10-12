import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..currencies import DEFAULT_CURRENCY, convert, format_money
from ..deps import require_admin, require_user
from ..notifications import notify
from ..referrals import credit_first_purchase
from .payments import get_fee_rate_for_seller, get_wallet, refund_txn

logger = logging.getLogger("tradehub")

router = APIRouter()


@router.post("", status_code=201)
def create_dispute(body: dict = Body(...), user: dict = Depends(require_user)):
    transaction_id = body.get("transactionId")
    reason = body.get("reason")
    description = body.get("description", "")

    details = []
    if not transaction_id:
        details.append("transactionId: Required")
    if not reason:
        details.append("reason: Reason is required")
    elif len(str(reason)) > 500:
        details.append("reason: String must contain at most 500 character(s)")
    if description is not None and len(str(description)) > 2000:
        details.append("description: String must contain at most 2000 character(s)")
    if details:
        raise HTTPException(status_code=400, detail={"error": "Validation failed", "details": details})

    txn = db.get("SELECT * FROM transactions WHERE id = ?", (transaction_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})

    if txn["buyer_id"] != user["id"] and txn["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not your transaction"})

    existing = db.get(
        "SELECT id FROM disputes WHERE transaction_id = ? AND status = 'open'",
        (transaction_id,),
    )
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"error": "An open dispute already exists for this transaction"},
        )

    dispute_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO disputes (id, transaction_id, opened_by, reason, description) "
        "VALUES (?, ?, ?, ?, ?)",
        (dispute_id, transaction_id, user["id"], reason, description or ""),
    )
    db.run("UPDATE transactions SET status = 'disputed' WHERE id = ?", (transaction_id,))

    dispute = db.get("SELECT * FROM disputes WHERE id = ?", (dispute_id,))
    return {"dispute": dispute}


@router.get("")
def list_disputes(user: dict = Depends(require_user)):
    if user.get("isAdmin"):
        disputes = db.all(
            "SELECT d.*, t.item_title, t.amount, t.status as txn_status, "
            "buyer.name as buyer_name, seller.name as seller_name, opener.name as opener_name "
            "FROM disputes d "
            "JOIN transactions t ON d.transaction_id = t.id "
            "LEFT JOIN users buyer ON buyer.id = t.buyer_id "
            "LEFT JOIN users seller ON seller.id = t.seller_id "
            "LEFT JOIN users opener ON opener.id = d.opened_by "
            "ORDER BY d.created_at DESC"
        )
    else:
        disputes = db.all(
            "SELECT d.*, t.item_title, t.amount, t.status as txn_status "
            "FROM disputes d "
            "JOIN transactions t ON d.transaction_id = t.id "
            "WHERE t.buyer_id = ? OR t.seller_id = ? "
            "ORDER BY d.created_at DESC",
            (user["id"], user["id"]),
        )
    return {"disputes": disputes}


@router.get("/{dispute_id}")
def get_dispute(dispute_id: str, user: dict = Depends(require_user)):
    dispute = db.get(
        "SELECT d.*, t.item_title FROM disputes d "
        "JOIN transactions t ON d.transaction_id = t.id "
        "WHERE d.id = ?",
        (dispute_id,),
    )
    if not dispute:
        raise HTTPException(status_code=404, detail={"error": "Dispute not found"})

    txn = db.get("SELECT * FROM transactions WHERE id = ?", (dispute["transaction_id"],))
    if txn["buyer_id"] != user["id"] and txn["seller_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    return {"dispute": dispute}


@router.put("/{dispute_id}/resolve")
def resolve_dispute(
    dispute_id: str,
    body: dict = Body(...),
    user: dict = Depends(require_admin),
):
    resolution = body.get("resolution")
    action = body.get("action")
    if action not in ("refund_buyer", "release_seller"):
        raise HTTPException(status_code=400, detail={"error": "Invalid resolution action"})

    dispute = db.get("SELECT * FROM disputes WHERE id = ?", (dispute_id,))
    if not dispute:
        raise HTTPException(status_code=404, detail={"error": "Dispute not found"})

    if dispute["status"] != "open":
        raise HTTPException(status_code=400, detail={"error": "Dispute is already resolved"})

    txn = db.get("SELECT * FROM transactions WHERE id = ?", (dispute["transaction_id"],))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})

    amount_cents = round(convert(txn["amount"], txn.get("currency") or DEFAULT_CURRENCY, "NGN") * 100)
    fee_cents = round(amount_cents * get_fee_rate_for_seller(txn["seller_id"]))
    net_cents = amount_cents - fee_cents

    if action == "refund_buyer":
        refund_txn(txn)
        notify(
            txn["buyer_id"],
            "system",
            "Dispute Resolved",
            f"Your dispute for \"{txn['item_title']}\" was resolved. Payment of "
            f"{format_money(txn['amount'], txn.get('currency'))} has been refunded.",
        )
        notify(
            txn["seller_id"],
            "system",
            "Dispute Resolved",
            f"The dispute for \"{txn['item_title']}\" was resolved in the buyer's favor.",
        )
    elif action == "release_seller":
        if txn["status"] != "completed":
            get_wallet(txn["seller_id"])
            db.run(
                "UPDATE wallets SET available_cents = available_cents + ?, "
                "lifetime_cents = lifetime_cents + ?, updated_at = datetime('now') "
                "WHERE user_id = ?",
                (net_cents, net_cents, txn["seller_id"]),
            )
            db.run(
                "UPDATE transactions SET status = 'completed', completed_at = datetime('now'), "
                "fee_amount = ?, net_amount = ? WHERE id = ?",
                (fee_cents / 100, net_cents / 100, dispute["transaction_id"]),
            )
            credit_first_purchase(txn["buyer_id"])
        notify(
            txn["buyer_id"],
            "system",
            "Dispute Resolved",
            f"Your dispute for \"{txn['item_title']}\" was resolved in the seller's favor.",
        )
        notify(
            txn["seller_id"],
            "system",
            "Dispute Resolved",
            f"The dispute for \"{txn['item_title']}\" was resolved in your favor. Payment released.",
        )

    db.run(
        "UPDATE disputes SET status = 'resolved', resolution = ?, resolved_by = ?, "
        "resolved_at = datetime('now') WHERE id = ?",
        (resolution or "", user["id"], dispute_id),
    )

    return {"success": True}
