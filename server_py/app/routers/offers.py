import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..currencies import format_money
from ..deps import require_user
from ..notifications import notify

logger = logging.getLogger("tradehub")

router = APIRouter()

OFFER_COLUMNS = (
    "o.id, o.item_id, o.buyer_id, o.seller_id, o.amount_cents, o.currency, "
    "o.message, o.status, o.offered_by, o.parent_offer_id, o.responder_note, "
    "o.created_at, o.updated_at, "
    "i.title AS item_title, i.status AS item_status, "
    "(SELECT url FROM item_images WHERE item_id = o.item_id ORDER BY sort_order LIMIT 1) AS item_image, "
    "(SELECT price FROM items WHERE id = o.item_id) AS item_price, "
    "(SELECT sale_price FROM items WHERE id = o.item_id) AS item_sale_price, "
    "u.name AS buyer_name, u.avatar AS buyer_avatar, "
    "s.name AS seller_name, s.avatar AS seller_avatar"
)

OFFER_JOINS = (
    "FROM offers o LEFT JOIN items i ON i.id = o.item_id "
    "LEFT JOIN users u ON u.id = o.buyer_id "
    "LEFT JOIN users s ON s.id = o.seller_id"
)


def get_offer(offer_id):
    return db.get(f"SELECT {OFFER_COLUMNS} {OFFER_JOINS} WHERE o.id = ?", (offer_id,))


def validate_offer_act(user, offer, action):
    if not offer:
        raise HTTPException(status_code=404, detail={"error": "Offer not found"})
    if offer["status"] != "pending":
        raise HTTPException(status_code=400, detail={"error": f"Offer is already {offer['status']}"})

    is_buyers_offer = offer["offered_by"] == "buyer"
    if action == "accept":
        allowed = offer["seller_id"] == user["id"] if is_buyers_offer else offer["buyer_id"] == user["id"]
        msg = "Not authorized to accept this offer"
    elif action == "decline":
        allowed = offer["seller_id"] == user["id"] if is_buyers_offer else offer["buyer_id"] == user["id"]
        msg = "Not authorized to decline this offer"
    else:  # cancel
        allowed = offer["buyer_id"] == user["id"] if is_buyers_offer else offer["seller_id"] == user["id"]
        msg = "Not authorized to cancel this offer"
    if not allowed:
        raise HTTPException(status_code=403, detail={"error": msg})
    return offer


def offer_parties(offer):
    if offer["offered_by"] == "buyer":
        return {"offeree": offer["seller_id"], "offeror": offer["buyer_id"]}
    return {"offeree": offer["buyer_id"], "offeror": offer["seller_id"]}


@router.post("", status_code=201)
def create_offer(body: dict = Body(...), user: dict = Depends(require_user)):
    item_id = body.get("itemId")
    message = body.get("message", "")
    try:
        amount = round(float(body.get("amountCents")))
    except (TypeError, ValueError):
        amount = 0

    if not item_id:
        raise HTTPException(status_code=400, detail={"error": "Item required"})
    if not amount or amount <= 0:
        raise HTTPException(status_code=400, detail={"error": "Offer amount must be greater than 0"})
    if len(str(message)) > 500:
        raise HTTPException(status_code=400, detail={"error": "Message too long (max 500 characters)"})

    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Cannot make an offer on your own item"})
    if item["status"] != "active":
        raise HTTPException(status_code=400, detail={"error": "Item is not available for offers"})

    pending = db.get(
        "SELECT * FROM offers WHERE item_id = ? AND buyer_id = ? AND status = 'pending'",
        (item_id, user["id"]),
    )
    if pending:
        raise HTTPException(status_code=400, detail={"error": "You already have a pending offer on this item"})

    offer_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO offers (id, item_id, buyer_id, seller_id, amount_cents, currency, message, status, offered_by) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'buyer')",
        (
            offer_id,
            item_id,
            user["id"],
            item["seller_id"],
            amount,
            item["currency"] or "NGN",
            str(message).strip(),
        ),
    )

    notify(
        item["seller_id"],
        "offer",
        "New Offer Received",
        f'You have a new offer of {format_money(amount / 100, item["currency"] or "NGN")} on "{item["title"]}".',
    )

    return {"offer": get_offer(offer_id)}


@router.get("/incoming")
def incoming_offers(user: dict = Depends(require_user)):
    offers = db.all(
        f"SELECT {OFFER_COLUMNS} {OFFER_JOINS} WHERE o.seller_id = ? ORDER BY o.created_at DESC",
        (user["id"],),
    )
    return {"offers": offers}


@router.get("/outgoing")
def outgoing_offers(user: dict = Depends(require_user)):
    offers = db.all(
        f"SELECT {OFFER_COLUMNS} {OFFER_JOINS} WHERE o.buyer_id = ? ORDER BY o.created_at DESC",
        (user["id"],),
    )
    return {"offers": offers}


@router.get("/item/{item_id}")
def item_offers(item_id: str, user: dict = Depends(require_user)):
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] != user["id"] and not user["isAdmin"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    offers = db.all(
        f"SELECT {OFFER_COLUMNS} {OFFER_JOINS} WHERE o.item_id = ? ORDER BY o.created_at DESC",
        (item["id"],),
    )
    return {"offers": offers}


@router.post("/{offer_id}/accept")
def accept_offer(offer_id: str, user: dict = Depends(require_user)):
    offer = validate_offer_act(user, get_offer(offer_id), "accept")
    parties = offer_parties(offer)
    is_buyers_offer = offer["offered_by"] == "buyer"

    db.run(
        "UPDATE offers SET status = 'accepted', updated_at = datetime('now') WHERE id = ?",
        (offer["id"],),
    )
    db.run(
        "UPDATE offers SET status = 'declined', updated_at = datetime('now') "
        "WHERE item_id = ? AND status = 'pending' AND id != ?",
        (offer["item_id"], offer["id"]),
    )

    item = db.get("SELECT * FROM items WHERE id = ?", (offer["item_id"],))
    if item and item["status"] == "active":
        db.run(
            "UPDATE items SET status = 'sold', sold_to = ?, updated_at = datetime('now') WHERE id = ?",
            (offer["buyer_id"], offer["item_id"]),
        )

    if is_buyers_offer:
        msg = (
            f'Your offer of {format_money(offer["amount_cents"] / 100, offer["currency"])} '
            f'on "{offer["item_title"]}" was accepted. Proceed to payment.'
        )
    else:
        msg = f'Your counter-offer of {format_money(offer["amount_cents"] / 100, offer["currency"])} was accepted.'
    notify(parties["offeror"], "offer", "Offer Accepted", msg)

    return {"success": True, "offer": get_offer(offer["id"])}


@router.post("/{offer_id}/decline")
def decline_offer(offer_id: str, body: dict | None = Body(default=None), user: dict = Depends(require_user)):
    offer = validate_offer_act(user, get_offer(offer_id), "decline")
    parties = offer_parties(offer)
    note = str((body or {}).get("note", "")).strip()[:500]

    db.run(
        "UPDATE offers SET status = 'declined', responder_note = ?, updated_at = datetime('now') WHERE id = ?",
        (note, offer["id"]),
    )
    notify(
        parties["offeror"],
        "offer",
        "Offer Declined",
        f'Your offer of {format_money(offer["amount_cents"] / 100, offer["currency"])} on "{offer["item_title"]}" was declined.',
    )

    return {"success": True, "offer": get_offer(offer["id"])}


@router.post("/{offer_id}/counter", status_code=201)
def counter_offer(offer_id: str, body: dict = Body(...), user: dict = Depends(require_user)):
    offer = validate_offer_act(user, get_offer(offer_id), "decline")
    message = body.get("message", "")
    try:
        amount = round(float(body.get("amountCents")))
    except (TypeError, ValueError):
        amount = 0
    if not amount or amount <= 0:
        raise HTTPException(status_code=400, detail={"error": "Counter amount must be greater than 0"})

    is_buyers_offer = offer["offered_by"] == "buyer"
    new_offered_by = "seller" if is_buyers_offer else "buyer"

    db.run(
        "UPDATE offers SET status = 'countered', responder_note = ?, updated_at = datetime('now') WHERE id = ?",
        (str(message).strip()[:500], offer["id"]),
    )

    new_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO offers (id, item_id, buyer_id, seller_id, amount_cents, currency, message, status, offered_by, parent_offer_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
        (
            new_id,
            offer["item_id"],
            offer["buyer_id"],
            offer["seller_id"],
            amount,
            offer["currency"],
            str(message).strip(),
            new_offered_by,
            offer["id"],
        ),
    )

    notify(
        offer["buyer_id"],
        "offer",
        "Counter-Offer Received",
        f'You received a counter-offer of {format_money(amount / 100, offer["currency"])} on "{offer["item_title"]}".',
    )

    return {"offer": get_offer(new_id)}


@router.post("/{offer_id}/cancel")
def cancel_offer(offer_id: str, user: dict = Depends(require_user)):
    offer = validate_offer_act(user, get_offer(offer_id), "cancel")
    parties = offer_parties(offer)

    db.run(
        "UPDATE offers SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
        (offer["id"],),
    )
    notify(parties["offeree"], "offer", "Offer Withdrawn", f'An offer on "{offer["item_title"]}" was withdrawn.')

    return {"success": True, "offer": get_offer(offer["id"])}