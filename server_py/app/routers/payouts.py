import json
import logging
import math
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import config, db
from ..deps import require_admin, require_user
from ..notifications import notify
from ..paystack import PaystackError, is_paystack_configured, paystack

logger = logging.getLogger("tradehub")

router = APIRouter()

PAYOUT_METHODS = ["bank"]


def _round_number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(math.floor(float(value) + 0.5))
    except (TypeError, ValueError):
        return None


def _get_wallet(user_id):
    w = db.get("SELECT * FROM wallets WHERE user_id = ?", (user_id,))
    if not w:
        db.run("INSERT INTO wallets (user_id) VALUES (?)", (user_id,))
        w = db.get("SELECT * FROM wallets WHERE user_id = ?", (user_id,))
    return w


# ---- Paystack bank list (transfer destinations) -------------------------------


@router.get("/banks")
def list_banks(user: dict = Depends(require_user), country: str = None):
    try:
        banks = paystack.list_banks(country)
        return {"banks": banks or [], "country": country or config.PAYSTACK_BANK_COUNTRY or "nigeria"}
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})


# ---- Wallet / payouts ---------------------------------------------------------


@router.get("/balance")
def payout_balance(user: dict = Depends(require_user)):
    return {"wallet": _get_wallet(user["id"])}


@router.get("")
def list_payouts(user: dict = Depends(require_user)):
    payouts = db.all(
        "SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],),
    )
    return {"payouts": payouts}


@router.post("", status_code=201)
def request_payout(user: dict = Depends(require_user), body: dict = Body(...)):
    amount = _round_number(body.get("amountCents"))
    method = body.get("method")
    details = body.get("details")

    if not amount or amount < 100:
        raise HTTPException(status_code=400, detail={"error": "Amount must be at least $1.00"})
    if method not in PAYOUT_METHODS:
        raise HTTPException(status_code=400, detail={"error": "Invalid payout method"})
    if not details or not isinstance(details, dict):
        raise HTTPException(status_code=400, detail={"error": "Payout details required"})

    wallet = _get_wallet(user["id"])
    if wallet["available_cents"] < amount:
        raise HTTPException(status_code=400, detail={"error": "Insufficient available balance"})

    db.run(
        "UPDATE wallets SET available_cents = available_cents - ?, pending_cents = pending_cents + ?, "
        "updated_at = datetime('now') WHERE user_id = ?",
        (amount, amount, user["id"]),
    )

    payout_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO payouts (id, user_id, amount_cents, method, method_details, status) "
        "VALUES (?, ?, ?, ?, ?, 'pending')",
        (payout_id, user["id"], amount, method, json.dumps(details)),
    )
    payout = db.get("SELECT * FROM payouts WHERE id = ?", (payout_id,))
    return {"payout": payout}


@router.get("/all")
def list_all_payouts(user: dict = Depends(require_admin)):
    payouts = db.all(
        """
        SELECT p.*, u.name as user_name, u.email as user_email
        FROM payouts p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC
        """,
    )
    return {"payouts": payouts}


@router.post("/{payout_id}/cancel")
def cancel_payout(payout_id: str, user: dict = Depends(require_user)):
    payout = db.get(
        "SELECT * FROM payouts WHERE id = ? AND user_id = ?", (payout_id, user["id"])
    )
    if not payout:
        raise HTTPException(status_code=404, detail={"error": "Payout not found"})
    if payout["status"] != "pending":
        raise HTTPException(status_code=400, detail={"error": "Only pending payouts can be cancelled"})

    db.run("UPDATE payouts SET status = 'cancelled' WHERE id = ?", (payout["id"],))
    db.run(
        "UPDATE wallets SET available_cents = available_cents + ?, pending_cents = pending_cents - ?, "
        "updated_at = datetime('now') WHERE user_id = ?",
        (payout["amount_cents"], payout["amount_cents"], payout["user_id"]),
    )
    return {"success": True}


@router.put("/{payout_id}/status")
def update_payout_status(payout_id: str, user: dict = Depends(require_admin), body: dict = Body(...)):
    status = body.get("status")
    notes = body.get("notes", "")

    payout = db.get("SELECT * FROM payouts WHERE id = ?", (payout_id,))
    if not payout:
        raise HTTPException(status_code=404, detail={"error": "Payout not found"})
    if status not in ("approved", "completed", "rejected"):
        raise HTTPException(status_code=400, detail={"error": "Invalid status"})

    if status == "rejected" and payout["status"] != "rejected":
        db.run(
            "UPDATE wallets SET available_cents = available_cents + ?, pending_cents = pending_cents - ?, "
            "updated_at = datetime('now') WHERE user_id = ?",
            (payout["amount_cents"], payout["amount_cents"], payout["user_id"]),
        )
        notify(
            payout["user_id"],
            "payment",
            "Payout Rejected",
            f"Your payout of \u20a6{payout['amount_cents'] / 100:.2f} was rejected.",
        )
    if status == "completed":
        db.run(
            "UPDATE wallets SET pending_cents = pending_cents - ?, updated_at = datetime('now') WHERE user_id = ?",
            (payout["amount_cents"], payout["user_id"]),
        )
        notify(
            payout["user_id"],
            "payment",
            "Payout Sent",
            f"Your payout of \u20a6{payout['amount_cents'] / 100:.2f} has been sent.",
        )

    db.run(
        "UPDATE payouts SET status = ?, admin_notes = ?, processed_at = datetime('now') WHERE id = ?",
        (status, notes, payout["id"]),
    )
    return {"success": True, "payout": db.get("SELECT * FROM payouts WHERE id = ?", (payout["id"],))}


# ---- Paystack transfer processing (admin) -------------------------------------


@router.post("/{payout_id}/process")
def process_payout(payout_id: str, admin: dict = Depends(require_admin)):
    payout = db.get("SELECT * FROM payouts WHERE id = ?", (payout_id,))
    if not payout:
        raise HTTPException(status_code=404, detail={"error": "Payout not found"})
    if payout["method"] != "bank":
        raise HTTPException(status_code=400, detail={"error": "Only bank payouts can be processed"})
    if payout["status"] not in ("pending", "approved"):
        raise HTTPException(status_code=400, detail={"error": "Payout cannot be processed in its current state"})
    if not is_paystack_configured():
        raise HTTPException(status_code=503, detail={"error": "Payments are not configured"})

    try:
        details = json.loads(payout.get("method_details") or "{}")
    except (TypeError, ValueError):
        details = {}

    try:
        recipient = paystack.create_transfer_recipient(
            type_="nuban",
            name=details.get("accountName") or admin.get("name") or "TradeHub Seller",
            account_number=details.get("accountNumber"),
            bank_code=details.get("bankCode") or details.get("bankName"),
        )
        recipient_code = (recipient or {}).get("recipient_code")
        if not recipient_code:
            raise HTTPException(status_code=502, detail={"error": "Could not create transfer recipient"})
        transfer = paystack.initiate_transfer(
            amount_minor=payout["amount_cents"],
            recipient_code=recipient_code,
            reference=payout["id"],
            reason="TradeHub payout",
        )
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})

    transfer_code = (transfer or {}).get("transfer_code") or (transfer or {}).get("id")
    db.run(
        "UPDATE payouts SET recipient_code = ?, transfer_code = ?, provider_ref = ?, status = 'approved' "
        "WHERE id = ?",
        (recipient_code, transfer_code, transfer_code, payout["id"]),
    )
    return {"success": True, "payout": db.get("SELECT * FROM payouts WHERE id = ?", (payout["id"],))}
