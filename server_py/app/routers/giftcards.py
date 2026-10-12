import logging
import random
import re
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..datetime_util import parse_iso, utc_now
from ..deps import require_admin, require_user

logger = logging.getLogger("tradehub")

router = APIRouter()

GIFT_CARD_TYPES = ["digital", "physical"]

DEFAULT_BRANDS = [
    {"name": "Amazon Gift Card", "category": "retail", "description": "Shop anything on Amazon with this balance.", "frontImage": "/uploads/amazon-gift-card.png"},
    {"name": "Apple Gift Card / iTunes Gift Card", "category": "digital", "description": "Apps, music, movies and more from Apple and iTunes.", "frontImage": "/uploads/apple-itunes-gift-card.png"},
    {"name": "Walmart Gift Card", "category": "retail", "description": "Groceries, electronics, fashion and more at Walmart.", "frontImage": "/uploads/walmart-gift-card.png"},
    {"name": "Starbucks Gift Card", "category": "food", "description": "Coffee, snacks and more at Starbucks.", "frontImage": "/uploads/starbucks-gift-card.png"},
    {"name": "American Express & Visa Gift Cards", "category": "finance", "description": "Prepaid cards accepted anywhere American Express or Visa cards are.", "frontImage": "/uploads/amex-visa-gift-card.jpg"},
    {"name": "Google Play Gift Card", "category": "digital", "description": "Apps, games, movies and books on Google Play.", "frontImage": "/uploads/google-play-gift-card.jpg"},
    {"name": "Sephora Gift Card", "category": "retail", "description": "Beauty, makeup and skincare at Sephora.", "frontImage": "/uploads/sephora-gift-card.jpg"},
    {"name": "TradeHub Gift Card", "category": "general", "description": "TradeHub's all-purpose gift card. Redeem for store credit to use on any listing, listing boost or subscription on the marketplace.", "frontImage": "/uploads/tradehub-gift-card.svg", "backImage": "/uploads/tradehub-gift-card-back.svg"},
]

BRAND_MERGES = [
    {"from": "Apple Gift Card", "to": "Apple Gift Card / iTunes Gift Card", "description": "Apps, music, movies and more from Apple and iTunes."},
    {"from": "American Express Gift Card", "to": "American Express & Visa Gift Cards", "description": "Prepaid cards accepted anywhere American Express or Visa cards are."},
    {"from": "Amazon", "to": "Amazon Gift Card", "description": "Shop anything on Amazon with this balance."},
    {"from": "Starbucks", "to": "Starbucks Gift Card", "description": "Coffee, snacks and more at Starbucks."},
]

RETIRED_BRANDS = ["Steam", "Netflix", "iTunes Gift Card", "Visa Gift Card", "Amazon", "Starbucks", "Smoke Brand"]


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
    def find(name):
        return db.get("SELECT * FROM gift_card_brands WHERE name = ?", (name,))

    for merge in BRAND_MERGES:
        source = find(merge["from"])
        if not source:
            continue
        target = find(merge["to"])
        if target:
            db.run("UPDATE gift_card_brands SET active = 0 WHERE id = ?", (source["id"],))
        else:
            db.run(
                "UPDATE gift_card_brands SET name = ?, description = ? WHERE id = ?",
                (merge["to"], merge["description"], source["id"]),
            )

    for brand in DEFAULT_BRANDS:
        if not find(brand["name"]):
            db.run(
                "INSERT INTO gift_card_brands (id, name, description, category) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), brand["name"], brand["description"], brand["category"]),
            )
    for brand in DEFAULT_BRANDS:
        db.run(
            "UPDATE gift_card_brands SET front_image = ? WHERE name = ? AND (front_image IS NULL OR front_image = '')",
            (brand["frontImage"], brand["name"]),
        )
        if brand.get("backImage"):
            db.run(
                "UPDATE gift_card_brands SET back_image = ? WHERE name = ? AND (back_image IS NULL OR back_image = '')",
                (brand["backImage"], brand["name"]),
            )
        db.run("UPDATE gift_card_brands SET active = 1 WHERE name = ?", (brand["name"],))
    for name in RETIRED_BRANDS:
        db.run("UPDATE gift_card_brands SET active = 0 WHERE name = ?", (name,))


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
    return {"brands": brands}


@router.get("/brands/all")
def list_all_brands(user: dict = Depends(require_admin)):
    seed_default_brands()
    brands = db.all("SELECT * FROM gift_card_brands ORDER BY active DESC, name")
    return {"brands": brands}


@router.post("/brands", status_code=201)
def create_brand(user: dict = Depends(require_admin), body: dict = Body(...)):
    name = body.get("name")
    description = body.get("description", "")
    category = body.get("category", "general")
    front_image = body.get("frontImage", "")
    back_image = body.get("backImage", "")
    active = body.get("active", 1)

    if not name or not str(name).strip():
        raise HTTPException(status_code=400, detail={"error": "Brand name required"})

    brand_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO gift_card_brands (id, name, description, category, front_image, back_image, active) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (brand_id, str(name).strip(), description, category, front_image, back_image, 1 if active else 0),
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

    next_name = str(name).strip() if name and str(name).strip() else brand["name"]
    next_description = description if description is not None else brand["description"]
    next_category = category or brand["category"]
    next_front = front_image if front_image is not None else brand["front_image"]
    next_back = back_image if back_image is not None else brand["back_image"]
    next_active = (1 if active else 0) if active is not None else brand["active"]

    db.run(
        "UPDATE gift_card_brands SET name = ?, description = ?, category = ?, front_image = ?, "
        "back_image = ?, active = ? WHERE id = ?",
        (next_name, next_description, next_category, next_front, next_back, next_active, brand["id"]),
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
    return {"brands": brands, "canSubmit": True}


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

    if not amount or amount < 100:
        raise HTTPException(status_code=400, detail={"error": "Amount must be at least \u20a61"})
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
