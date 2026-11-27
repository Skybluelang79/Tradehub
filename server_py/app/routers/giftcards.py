import logging
import random
import re
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import config, db
from ..currencies import convert, format_money
from ..datetime_util import parse_iso, utc_now
from ..deps import require_admin, require_user
from ..notifications import notify
from ..paystack import (
    PAYSTACK_PUBLIC_KEY,
    PaystackError,
    is_paystack_configured,
    paystack,
    to_minor_units,
)

logger = logging.getLogger("tradehub")

router = APIRouter()

GIFT_CARD_TYPES = ["digital", "physical"]

TRADEHUB_BRAND_NAME = "TradeHub Gift Card"
GIFT_CARD_DENOMINATIONS_CENTS = [2000, 5000, 10000, 50000, 100000]
ALLOW_DEMO_PAYMENTS = config.DEMO_MODE or not config.IS_PRODUCTION

DEFAULT_BRANDS = [
    {
        "name": TRADEHUB_BRAND_NAME,
        "category": "general",
        "description": "TradeHub's all-purpose gift card. Redeem for store credit to use on any listing, listing boost or subscription on the marketplace.",
        "frontImage": "/uploads/tradehub-gift-card.svg",
        "backImage": "/uploads/tradehub-gift-card-back.svg",
    },
]


def _parse_int(value, default=None):
    match = re.match(r"^\s*([+-]?\d+)", str(value))
    if not match:
        return default
    return int(match.group(1))


def _round_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number + 0.5) if number >= 0 else -int(-number + 0.5)


def seed_default_brands():
    brand = DEFAULT_BRANDS[0]
    existing = db.get("SELECT * FROM gift_card_brands WHERE name = ?", (brand["name"],))
    if not existing:
        db.run(
            "INSERT INTO gift_card_brands (id, name, description, category, active, sellable) "
            "VALUES (?, ?, ?, ?, 1, 1)",
            (str(uuid.uuid4()), brand["name"], brand["description"], brand["category"]),
        )
    db.run(
        "UPDATE gift_card_brands SET description = ?, category = ?, front_image = ?, "
        "back_image = ?, active = 1, sellable = 1 WHERE name = ?",
        (brand["description"], brand["category"], brand["frontImage"], brand.get("backImage", ""), brand["name"]),
    )
    db.run(
        "UPDATE gift_card_brands SET active = 0, sellable = 0 WHERE name != ?",
        (TRADEHUB_BRAND_NAME,),
    )


def generate_gift_code(prefix="TRADE"):
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    def block():
        return "".join(random.choice(chars) for _ in range(4))

    return f"{prefix}-{block()}-{block()}-{block()}"


def get_wallet(user_id):
    w = db.get("SELECT * FROM wallets WHERE user_id = ?", (user_id,))
    if not w:
        db.run("INSERT INTO wallets (user_id) VALUES (?)", (user_id,))
        w = db.get("SELECT * FROM wallets WHERE user_id = ?", (user_id,))
    return w


def complete_gift_card_purchase(purchase_id):
    purchase = db.get("SELECT * FROM gift_card_purchases WHERE id = ?", (purchase_id,))
    if not purchase or purchase["status"] != "pending":
        return None
    brand = db.get("SELECT name FROM gift_card_brands WHERE id = ?", (purchase["brand_id"],))
    brand_name = brand["name"] if brand else TRADEHUB_BRAND_NAME
    card_id = str(uuid.uuid4())
    code = generate_gift_code("TRADE")
    db.run(
        "INSERT INTO gift_cards (id, code, brand_id, card_type, original_cents, purchase_cents, "
        "balance_cents, note, status, redeemed_by, redeemed_at, sold_to, sold_at, payment_reference) "
        "VALUES (?, ?, ?, 'digital', ?, ?, 0, 'Purchased in Gift Mall', 'redeemed', ?, "
        "datetime('now'), ?, datetime('now'), ?)",
        (
            card_id, code, purchase["brand_id"], purchase["amount_cents"],
            purchase["amount_cents"], purchase["user_id"], purchase["user_id"],
            purchase["reference"],
        ),
    )
    get_wallet(purchase["user_id"])
    db.run(
        "UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime('now') WHERE user_id = ?",
        (purchase["amount_cents"], purchase["user_id"]),
    )
    db.run(
        "UPDATE gift_card_purchases SET status = 'completed', card_id = ?, completed_at = datetime('now') "
        "WHERE id = ?",
        (card_id, purchase["id"]),
    )
    notify(
        purchase["user_id"],
        "payment",
        "Gift Card Credited",
        f"{format_money(purchase['amount_cents'] / 100, 'USD')} was added to your store credit from your {brand_name} purchase.",
    )
    return db.get(
        "SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image "
        "FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id WHERE g.id = ?",
        (card_id,),
    )


def redeem_gift_card(code, user_id):
    card = db.get(
        "SELECT * FROM gift_cards WHERE UPPER(code) = ?", (str(code or "").strip().upper(),)
    )
    if not card:
        raise ValueError("Invalid gift card code")
    if card["status"] == "redeemed":
        raise ValueError("Gift card already redeemed")
    if card["status"] == "voided":
        raise ValueError("Gift card has been voided")
    if card["balance_cents"] <= 0:
        raise ValueError("Gift card has no balance")
    expires = parse_iso(card.get("expires_at"))
    if expires and expires < utc_now():
        raise ValueError("Gift card has expired")

    balance = card["balance_cents"]
    db.run(
        "UPDATE gift_cards SET status = 'redeemed', balance_cents = 0, redeemed_by = ?, "
        "redeemed_at = datetime('now') WHERE id = ?",
        (user_id, card["id"]),
    )
    get_wallet(user_id)
    db.run(
        "UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime('now') WHERE user_id = ?",
        (balance, user_id),
    )
    return balance


# ---- Brands -------------------------------------------------------------------


@router.get("/brands")
def list_brands(user: dict = Depends(require_user)):
    seed_default_brands()
    brands = db.all("SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name")
    return {"brands": brands, "denominationsCents": GIFT_CARD_DENOMINATIONS_CENTS}


@router.get("/brands/all")
def list_all_brands(user: dict = Depends(require_admin)):
    seed_default_brands()
    brands = db.all("SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name")
    return {"brands": brands, "denominationsCents": GIFT_CARD_DENOMINATIONS_CENTS}


@router.post("/brands", status_code=201)
def create_brand(user: dict = Depends(require_admin), body: dict = Body(...)):
    name = body.get("name")
    description = body.get("description", "")
    category = body.get("category", "general")
    front_image = body.get("frontImage", "")
    back_image = body.get("backImage", "")
    active = body.get("active", 1)
    sellable = body.get("sellable", 0)

    if not name or not str(name).strip():
        raise HTTPException(status_code=400, detail={"error": "Brand name required"})

    brand_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO gift_card_brands (id, name, description, category, front_image, back_image, active, sellable) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (brand_id, str(name).strip(), description, category, front_image, back_image, 1 if active else 0, 1 if sellable else 0),
    )
    return {"brand": db.get("SELECT * FROM gift_card_brands WHERE id = ?", (brand_id,))}


@router.put("/brands/{brand_id}")
def update_brand(brand_id: str, user: dict = Depends(require_admin), body: dict = Body(...)):
    brand = db.get("SELECT * FROM gift_card_brands WHERE id = ?", (brand_id,))
    if not brand:
        raise HTTPException(status_code=404, detail={"error": "Brand not found"})

    name = body.get("name")
    description = body.get("description")
    category = body.get("category")
    front_image = body.get("frontImage")
    back_image = body.get("backImage")
    active = body.get("active")
    sellable = body.get("sellable")

    next_name = str(name).strip() if name and str(name).strip() else brand["name"]
    next_description = description if description is not None else brand["description"]
    next_category = category or brand["category"]
    next_front = front_image if front_image is not None else brand["front_image"]
    next_back = back_image if back_image is not None else brand["back_image"]
    next_active = (1 if active else 0) if active is not None else brand["active"]
    next_sellable = (1 if sellable else 0) if sellable is not None else brand["sellable"]

    db.run(
        "UPDATE gift_card_brands SET name = ?, description = ?, category = ?, front_image = ?, "
        "back_image = ?, active = ?, sellable = ? WHERE id = ?",
        (next_name, next_description, next_category, next_front, next_back, next_active, next_sellable, brand["id"]),
    )
    return {"brand": db.get("SELECT * FROM gift_card_brands WHERE id = ?", (brand["id"],))}


@router.delete("/brands/{brand_id}")
def deactivate_brand(brand_id: str, user: dict = Depends(require_admin)):
    db.run("UPDATE gift_card_brands SET active = 0 WHERE id = ?", (brand_id,))
    return {"success": True}


# ---- Gift card mall (public) + design submissions -----------------------------


@router.get("/mall")
def gift_card_mall():
    seed_default_brands()
    brands = db.all("SELECT * FROM gift_card_brands WHERE active = 1 ORDER BY name")
    return {
        "brands": brands,
        "canSubmit": True,
        "denominationsCents": GIFT_CARD_DENOMINATIONS_CENTS,
    }


@router.post("/designs", status_code=201)
def submit_design(user: dict = Depends(require_user), body: dict = Body(...)):
    image_url = body.get("imageUrl")
    brand_id = body.get("brandId")
    note = body.get("note", "")

    if not image_url or not str(image_url).strip():
        raise HTTPException(status_code=400, detail={"error": "Card image required"})
    if not str(image_url).startswith("/uploads/"):
        raise HTTPException(status_code=400, detail={"error": "Card image must be an uploaded file"})
    if brand_id and not db.get("SELECT id FROM gift_card_brands WHERE id = ?", (brand_id,)):
        raise HTTPException(status_code=404, detail={"error": "Brand not found"})

    design_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO gift_card_designs (id, user_id, brand_id, image_url, note) VALUES (?, ?, ?, ?, ?)",
        (design_id, user["id"], brand_id or None, str(image_url).strip(), str(note or "")[:500]),
    )
    design = db.get(
        """
        SELECT d.*, u.name as user_name, b.name as brand_name
        FROM gift_card_designs d
        LEFT JOIN users u ON u.id = d.user_id
        LEFT JOIN gift_card_brands b ON b.id = d.brand_id
        WHERE d.id = ?
        """,
        (design_id,),
    )
    return {"success": True, "design": design}


@router.get("/designs")
def list_designs(status: str = "all", user: dict = Depends(require_admin)):
    query = (
        "SELECT d.*, u.name as user_name, b.name as brand_name, b.front_image as brand_front_image "
        "FROM gift_card_designs d "
        "LEFT JOIN users u ON u.id = d.user_id "
        "LEFT JOIN gift_card_brands b ON b.id = d.brand_id"
    )
    params = []
    if status != "all":
        query += " WHERE d.status = ?"
        params.append(status)
    query += " ORDER BY d.created_at DESC LIMIT 200"
    return {"designs": db.all(query, tuple(params))}


@router.put("/designs/{design_id}/status")
def update_design_status(design_id: str, user: dict = Depends(require_admin), body: dict = Body(...)):
    status = body.get("status")
    if status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=400, detail={"error": "Invalid status"})
    design = db.get("SELECT id FROM gift_card_designs WHERE id = ?", (design_id,))
    if not design:
        raise HTTPException(status_code=404, detail={"error": "Design not found"})
    db.run("UPDATE gift_card_designs SET status = ? WHERE id = ?", (status, design["id"]))
    return {"success": True}


# ---- Issue / analytics / management -------------------------------------------


@router.post("/issue", status_code=201)
def issue_gift_cards(user: dict = Depends(require_admin), body: dict = Body(...)):
    amount = _round_number(body.get("amountCents"))
    qty = min(max(_parse_int(body.get("count"), 1) or 1, 1), 100)
    note = body.get("note", "")
    brand_id = body.get("brandId")
    card_type = body.get("cardType", "digital")
    purchase_cents = body.get("purchaseCents")
    discount_percent = body.get("discountPercent", 0)

    if amount not in GIFT_CARD_DENOMINATIONS_CENTS:
        denominations = ", ".join(f"${value // 100}" for value in GIFT_CARD_DENOMINATIONS_CENTS)
        raise HTTPException(status_code=400, detail={"error": f"Choose a fixed value: {denominations}"})
    if card_type not in GIFT_CARD_TYPES:
        raise HTTPException(status_code=400, detail={"error": "Invalid card type"})

    prefix = "TRADE"
    if brand_id:
        brand = db.get("SELECT * FROM gift_card_brands WHERE id = ?", (brand_id,))
        if not brand:
            raise HTTPException(status_code=404, detail={"error": "Brand not found"})
        cleaned = re.sub(r"[^A-Za-z0-9]", "", brand["name"] or "TRADE")[:6].upper()
        prefix = cleaned or "TRADE"

    try:
        discount = float(discount_percent)
    except (TypeError, ValueError):
        discount = 0
    discount = min(max(discount, 0), 90)

    if purchase_cents is not None:
        purchase = _round_number(purchase_cents)
    else:
        purchase = _round_number(amount * (1 - discount / 100))

    codes = []
    for _ in range(qty):
        code = generate_gift_code(prefix)
        db.run(
            "INSERT INTO gift_cards (id, code, brand_id, card_type, original_cents, purchase_cents, "
            "balance_cents, issued_by, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), code, brand_id, card_type, amount, purchase, amount, user["id"], note),
        )
        codes.append(code)
    return {"codes": codes, "amountCents": amount, "purchaseCents": purchase, "brandId": brand_id, "cardType": card_type}


@router.get("/analytics")
def gift_card_analytics(user: dict = Depends(require_admin)):
    issued = db.get(
        "SELECT COUNT(*) as c, COALESCE(SUM(original_cents),0) as v, COALESCE(SUM(purchase_cents),0) as p FROM gift_cards"
    )
    redeemed = db.get(
        "SELECT COUNT(*) as c, COALESCE(SUM(original_cents),0) as v FROM gift_cards WHERE status = 'redeemed'"
    )
    active = db.get(
        "SELECT COUNT(*) as c, COALESCE(SUM(balance_cents),0) as v FROM gift_cards WHERE status = 'active'"
    )
    voided = db.get("SELECT COUNT(*) as c FROM gift_cards WHERE status = 'voided'")["c"]
    margin = max(0, issued["v"] - (issued["p"] or 0))
    by_brand = db.all(
        """
        SELECT b.id, b.name, COUNT(g.id) as issued, COALESCE(SUM(g.original_cents),0) as value,
               COALESCE(SUM(CASE WHEN g.status='redeemed' THEN g.original_cents END),0) as redeemed_value
        FROM gift_card_brands b LEFT JOIN gift_cards g ON g.brand_id = b.id
        GROUP BY b.id ORDER BY issued DESC
        """
    )
    return {
        "analytics": {
            "issuedCount": issued["c"],
            "issuedValue": issued["v"],
            "purchaseValue": issued["p"],
            "redeemedCount": redeemed["c"],
            "redeemedValue": redeemed["v"],
            "activeCount": active["c"],
            "activeValue": active["v"],
            "voidedCount": voided,
            "margin": margin,
            "byBrand": by_brand,
        }
    }


@router.get("/list")
def list_gift_cards(status: str = "all", limit: int = 50, user: dict = Depends(require_admin)):
    query = (
        "SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image "
        "FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id"
    )
    params = []
    if status != "all":
        query += " WHERE g.status = ?"
        params.append(status)
    query += " ORDER BY g.created_at DESC LIMIT ?"
    params.append(min(limit or 50, 200))
    return {"cards": db.all(query, tuple(params))}


@router.post("/{card_id}/void")
def void_gift_card(card_id: str, user: dict = Depends(require_admin)):
    card = db.get("SELECT * FROM gift_cards WHERE id = ?", (card_id,))
    if not card:
        raise HTTPException(status_code=404, detail={"error": "Gift card not found"})
    if card["status"] != "active":
        raise HTTPException(status_code=400, detail={"error": "Only active cards can be voided"})
    db.run(
        "UPDATE gift_cards SET status = 'voided', balance_cents = 0, voided_at = datetime('now'), "
        "voided_by = ? WHERE id = ?",
        (user["id"], card["id"]),
    )
    return {"success": True}


@router.post("/{card_id}/reset")
def reset_gift_card(card_id: str, user: dict = Depends(require_admin)):
    card = db.get("SELECT * FROM gift_cards WHERE id = ?", (card_id,))
    if not card:
        raise HTTPException(status_code=404, detail={"error": "Gift card not found"})
    if card["status"] not in ("redeemed", "voided", "expired"):
        raise HTTPException(
            status_code=400, detail={"error": "Only redeemed, voided or expired cards can be reset"}
        )

    if card["status"] == "redeemed" and card["redeemed_by"] and card["original_cents"] > 0:
        wallet = db.get("SELECT * FROM wallets WHERE user_id = ?", (card["redeemed_by"],))
        if wallet:
            credit = max(0, wallet["credit_cents"] - card["original_cents"])
            db.run(
                "UPDATE wallets SET credit_cents = ?, updated_at = datetime('now') WHERE user_id = ?",
                (credit, card["redeemed_by"]),
            )

    db.run(
        "UPDATE gift_cards SET status = 'active', balance_cents = ?, redeemed_by = NULL, "
        "redeemed_at = NULL, voided_at = NULL, voided_by = NULL WHERE id = ?",
        (card["original_cents"], card["id"]),
    )
    return {"success": True}


@router.post("/redeem")
def redeem(code_card: dict = Body(...), user: dict = Depends(require_user)):
    code = code_card.get("code")
    try:
        balance = redeem_gift_card(code, user["id"])
    except ValueError as err:
        raise HTTPException(status_code=400, detail={"error": str(err)})

    card_lookup = db.get(
        "SELECT id FROM gift_cards WHERE UPPER(code) = ?", (str(code or "").strip().upper(),)
    )
    card_row = db.get(
        """
        SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image
        FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id
        WHERE g.id = ?
        """,
        (card_lookup["id"],),
    ) if card_lookup else None
    return {
        "success": True,
        "creditCents": get_wallet(user["id"])["credit_cents"],
        "balanceCents": balance,
        "card": card_row,
    }


@router.post("/purchase-intent")
def purchase_gift_card_intent(body: dict = Body(...), user: dict = Depends(require_user)):
    brand_id = body.get("brandId")
    amount = _round_number(body.get("amountCents"))
    if not brand_id:
        raise HTTPException(status_code=400, detail={"error": "Choose a gift card brand"})
    brand = db.get("SELECT * FROM gift_card_brands WHERE id = ?", (brand_id,))
    if not brand or not brand["active"]:
        raise HTTPException(status_code=404, detail={"error": "Gift card brand not found"})
    if not brand["sellable"]:
        raise HTTPException(status_code=400, detail={"error": "This gift card is not available for purchase"})
    if amount not in GIFT_CARD_DENOMINATIONS_CENTS:
        values = ", ".join(format_money(value / 100, "USD") for value in GIFT_CARD_DENOMINATIONS_CENTS)
        raise HTTPException(status_code=400, detail={"error": f"Choose a fixed gift card value: {values}"})

    purchase_id = str(uuid.uuid4())
    currency = paystack.DEFAULT_CURRENCY
    charge_minor = to_minor_units(convert(amount / 100, "USD", currency), currency)
    db.run(
        "INSERT INTO gift_card_purchases (id, user_id, brand_id, amount_cents, charge_amount_minor, "
        "currency, reference, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
        (purchase_id, user["id"], brand["id"], amount, charge_minor, currency, purchase_id),
    )

    if not is_paystack_configured():
        if not ALLOW_DEMO_PAYMENTS:
            db.run("UPDATE gift_card_purchases SET status = 'failed' WHERE id = ?", (purchase_id,))
            raise HTTPException(
                status_code=503,
                detail={"error": "Payments are not configured. Set PAYSTACK_SECRET_KEY or enable DEMO_MODE."},
            )
        reference = f"demo_{purchase_id}"
        db.run("UPDATE gift_card_purchases SET reference = ? WHERE id = ?", (reference, purchase_id))
        card = complete_gift_card_purchase(purchase_id)
        return {
            "paid": True,
            "demo": True,
            "purchaseId": purchase_id,
            "reference": reference,
            "amountCents": amount,
            "currency": currency,
            "creditCents": get_wallet(user["id"])["credit_cents"],
            "card": card,
        }

    try:
        initialized = paystack.initialize_transaction(
            amount_minor=charge_minor,
            currency=currency,
            email=user.get("email") or "",
            reference=purchase_id,
            channels=["card"],
            metadata={
                "giftCardPurchaseId": purchase_id,
                "buyerId": user["id"],
                "brandId": brand["id"],
                "tradehub_gift_card": True,
            },
        )
    except PaystackError as err:
        db.run("UPDATE gift_card_purchases SET status = 'failed' WHERE id = ?", (purchase_id,))
        raise HTTPException(status_code=err.status or 502, detail={"error": str(err)})

    return {
        "purchaseId": purchase_id,
        "reference": purchase_id,
        "accessCode": initialized.get("access_code"),
        "authorizationUrl": initialized.get("authorization_url"),
        "publicKey": PAYSTACK_PUBLIC_KEY,
        "amountCents": amount,
        "currency": currency,
        "status": "awaiting_payment",
    }


@router.post("/purchase/verify/{reference}")
def verify_gift_card_purchase(reference: str, user: dict = Depends(require_user)):
    purchase = db.get("SELECT * FROM gift_card_purchases WHERE reference = ?", (reference,))
    if not purchase:
        raise HTTPException(status_code=404, detail={"error": "Gift card purchase not found"})
    if purchase["user_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    card_for = lambda card_id: db.get(
        "SELECT g.*, b.name as brand_name, b.front_image as brand_front_image, b.back_image as brand_back_image "
        "FROM gift_cards g LEFT JOIN gift_card_brands b ON b.id = g.brand_id WHERE g.id = ?",
        (card_id,),
    ) if card_id else None

    if purchase["status"] == "completed":
        return {
            "success": True,
            "alreadyProcessed": True,
            "status": "completed",
            "creditCents": get_wallet(purchase["user_id"])["credit_cents"],
            "card": card_for(purchase["card_id"]),
        }
    if purchase["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail={"error": f"Purchase is not awaiting payment ({purchase['status']})"},
        )

    if str(purchase["reference"]).startswith("demo_"):
        if is_paystack_configured() or not ALLOW_DEMO_PAYMENTS:
            raise HTTPException(status_code=400, detail={"error": "Demo purchase cannot be verified"})
    else:
        try:
            verified = paystack.verify_transaction(purchase["reference"])
        except PaystackError as err:
            raise HTTPException(status_code=err.status or 502, detail={"error": str(err)})
        if verified.get("status") != "success":
            raise HTTPException(
                status_code=400,
                detail={"error": f"Payment not successful ({verified.get('status') or 'unknown'})"},
            )

    card = complete_gift_card_purchase(purchase["id"])
    return {
        "success": True,
        "status": "completed",
        "creditCents": get_wallet(purchase["user_id"])["credit_cents"],
        "card": card,
    }
