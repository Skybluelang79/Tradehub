import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..datetime_util import parse_iso
from ..deps import require_user
from ..notifications import notify

logger = logging.getLogger("tradehub")

router = APIRouter()

MEETUP_STATUSES = ("proposed", "accepted", "declined", "completed", "cancelled")


def _normalize(row):
    row = dict(row)
    return row


def _load_meetup(meetup_id):
    row = db.get("SELECT * FROM meetups WHERE id = ?", (meetup_id,))
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Meetup not found"})
    return row


def _require_party(meetup, user):
    if user["id"] not in (meetup["buyer_id"], meetup["seller_id"]) and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})


def _notify_other(meetup, actor_id, title, body):
    other = meetup["seller_id"] if actor_id == meetup["buyer_id"] else meetup["buyer_id"]
    notify(other, "system", title, body, f'{{"meetupId":"{meetup["id"]}"}}')


@router.post("", status_code=201)
def create_meetup(body: dict = Body(...), user: dict = Depends(require_user)):
    txn_id = str(body.get("txnId") or body.get("transactionId") or "").strip()
    item_id = str(body.get("itemId") or "").strip()
    scheduled_raw = str(body.get("scheduledAt") or "").strip()
    scheduled = parse_iso(scheduled_raw)
    if not scheduled:
        raise HTTPException(status_code=400, detail={"error": "A valid scheduledAt is required"})

    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,)) if txn_id else None
    if txn_id and not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn:
        item_id = txn["item_id"]
        buyer_id = txn["buyer_id"]
        seller_id = txn["seller_id"]
    else:
        item = db.get("SELECT * FROM items WHERE id = ?", (item_id,)) if item_id else None
        if not item:
            raise HTTPException(status_code=404, detail={"error": "Item not found"})
        buyer_id = user["id"]
        seller_id = item["seller_id"]
        if buyer_id == seller_id:
            raise HTTPException(status_code=400, detail={"error": "Use an order to arrange a meetup on your own listing"})

    if user["id"] not in (buyer_id, seller_id) and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    latitude = body.get("latitude")
    longitude = body.get("longitude")
    try:
        latitude = float(latitude) if latitude not in (None, "") else None
        longitude = float(longitude) if longitude not in (None, "") else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail={"error": "Invalid meetup coordinates"})

    meetup_id = str(uuid.uuid4())
    db.run(
        """
        INSERT INTO meetups (id, txn_id, item_id, buyer_id, seller_id, proposed_by, status,
            location_name, address, latitude, longitude, scheduled_at, note)
        VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, ?, ?)
        """,
        (
            meetup_id, txn_id or None, item_id, buyer_id, seller_id, user["id"],
            str(body.get("locationName") or "")[:200],
            str(body.get("address") or "")[:300],
            latitude, longitude,
            scheduled.strftime("%Y-%m-%d %H:%M:%S"),
            str(body.get("note") or "")[:1000],
        ),
    )
    _notify_other(
        {"id": meetup_id, "buyer_id": buyer_id, "seller_id": seller_id},
        user["id"],
        "Meetup proposed",
        "A meetup time and place has been proposed for your TradeHub order.",
    )
    return {"meetup": _normalize(_load_meetup(meetup_id))}


@router.get("")
def list_meetups(user: dict = Depends(require_user)):
    if user.get("isAdmin"):
        rows = db.all("SELECT * FROM meetups ORDER BY scheduled_at DESC")
    else:
        rows = db.all(
            "SELECT * FROM meetups WHERE buyer_id = ? OR seller_id = ? ORDER BY scheduled_at DESC",
            (user["id"], user["id"]),
        )
    return {"meetups": [_normalize(row) for row in rows]}


@router.get("/transaction/{txn_id}")
def meetups_for_transaction(txn_id: str, user: dict = Depends(require_user)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if not user.get("isAdmin") and user["id"] not in (txn["buyer_id"], txn["seller_id"]):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    rows = db.all("SELECT * FROM meetups WHERE txn_id = ? ORDER BY scheduled_at DESC", (txn_id,))
    return {"meetups": [_normalize(row) for row in rows]}


@router.get("/{meetup_id}")
def get_meetup(meetup_id: str, user: dict = Depends(require_user)):
    meetup = _load_meetup(meetup_id)
    _require_party(meetup, user)
    return {"meetup": _normalize(meetup)}


def _transition(meetup_id, action, user):
    meetup = _load_meetup(meetup_id)
    _require_party(meetup, user)

    if action == "accept":
        if meetup["status"] != "proposed":
            raise HTTPException(status_code=409, detail={"error": "Only a proposed meetup can be accepted"})
        expected = meetup["buyer_id"] if meetup["proposed_by"] == meetup["seller_id"] else meetup["seller_id"]
        if not user.get("isAdmin") and user["id"] != expected:
            raise HTTPException(status_code=403, detail={"error": "Only the other party can accept this meetup"})
        next_status = "accepted"
        title = "Meetup accepted"
        body = "Your meetup time and place has been accepted."
    elif action == "decline":
        if meetup["status"] != "proposed":
            raise HTTPException(status_code=409, detail={"error": "Only a proposed meetup can be declined"})
        next_status = "declined"
        title = "Meetup declined"
        body = "The proposed meetup was declined. Suggest a new time."
    elif action == "complete":
        if meetup["status"] not in ("proposed", "accepted"):
            raise HTTPException(status_code=409, detail={"error": "This meetup can no longer be completed"})
        next_status = "completed"
        title = "Meetup completed"
        body = "The handoff was marked complete. Confirm receipt in Payments to release escrow."
    elif action == "cancel":
        if meetup["status"] in ("completed", "cancelled", "declined"):
            raise HTTPException(status_code=409, detail={"error": "This meetup is already closed"})
        next_status = "cancelled"
        title = "Meetup cancelled"
        body = "The meetup was cancelled."
    else:
        raise HTTPException(status_code=400, detail={"error": "Unsupported meetup action"})

    now = "datetime('now')"
    if next_status == "completed":
        db.run(
            f"UPDATE meetups SET status = ?, updated_at = {now}, completed_at = {now} WHERE id = ?",
            (next_status, meetup_id),
        )
    else:
        db.run(
            f"UPDATE meetups SET status = ?, updated_at = {now} WHERE id = ?",
            (next_status, meetup_id),
        )
    _notify_other(meetup, user["id"], title, body)
    return {"meetup": _normalize(_load_meetup(meetup_id))}


@router.post("/{meetup_id}/accept")
def accept_meetup(meetup_id: str, user: dict = Depends(require_user)):
    return _transition(meetup_id, "accept", user)


@router.post("/{meetup_id}/decline")
def decline_meetup(meetup_id: str, user: dict = Depends(require_user)):
    return _transition(meetup_id, "decline", user)


@router.post("/{meetup_id}/complete")
def complete_meetup(meetup_id: str, user: dict = Depends(require_user)):
    return _transition(meetup_id, "complete", user)


@router.post("/{meetup_id}/cancel")
def cancel_meetup(meetup_id: str, user: dict = Depends(require_user)):
    return _transition(meetup_id, "cancel", user)
