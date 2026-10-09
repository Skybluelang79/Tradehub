import json
import logging
import math
import re
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..currencies import format_money, is_valid_currency
from ..datetime_util import parse_iso, utc_now
from ..deps import optional_user, require_user
from ..notifications import notify
from ..validation import raise_validation

logger = logging.getLogger("tradehub")

router = APIRouter()

ITEM_STATUSES = ("active", "draft", "sold", "reserved", "ended")

DISTANCE_EXPR = (
    "6371.0 * 2 * ASIN(SQRT("
    "POWER(SIN((? - i.location_lat) * 0.017453292519943295 / 2), 2) + "
    "COS(? * 0.017453292519943295) * COS(i.location_lat * 0.017453292519943295) * "
    "POWER(SIN((? - i.location_lng) * 0.017453292519943295 / 2), 2)"
    "))"
)


def _is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _distance(lat1, lng1, lat2, lng2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _images_for(item_id):
    return [row["url"] for row in db.all(
        "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order", (item_id,)
    )]


def _sale_active(item):
    if not item.get("sale_price"):
        return False
    ends = parse_iso(item.get("sale_ends_at"))
    return not ends or ends > utc_now()


def _clean_named_string(field, value, max_len, details, required=False):
    if value is None:
        if required:
            if field in ("title",):
                details.append(f"{field}: Title is required")
            else:
                details.append(f"{field}: {field.capitalize()} is required")
        return None
    if not isinstance(value, str):
        details.append(f"{field}: Expected string, received {type(value).__name__}")
        return None
    if max_len is not None and len(value) > max_len:
        details.append(f"{field}: String must contain at most {max_len} character(s)")
    return value


def _clean_optional_number(field, value, details, positive=True):
    if value is None:
        return None
    if not _is_number(value):
        details.append(f"{field}: Expected number, received {type(value).__name__}")
        return None
    if positive and value <= 0:
        details.append(f"{field}: Number must be greater than 0")
        return None
    return value


def _clean_location(value, details):
    if value is None:
        return None
    if not isinstance(value, dict):
        details.append("location: Expected object, received ...")
        return None
    lat, lng = value.get("lat"), value.get("lng")
    if lat is not None and not _is_number(lat):
        details.append("location.lat: Expected number, received ...")
    if lng is not None and not _is_number(lng):
        details.append("location.lng: Expected number, received ...")
    if _is_number(lat) and (lat < -90 or lat > 90):
        details.append("location.lat: Number must be greater than or equal to -90")
    if _is_number(lng) and (lng < -180 or lng > 180):
        details.append("location.lng: Number must be less than or equal to 180")
    address = value.get("address")
    if address is not None and (not isinstance(address, str) or len(address) > 200):
        details.append("location.address: String must contain at most 200 character(s)")
    return value


def _clean_variants(value, details):
    if value is None:
        return None
    if not isinstance(value, list):
        details.append("variants: Expected array, received ...")
        return []
    cleaned = []
    for idx, variant in enumerate(value):
        if not isinstance(variant, dict):
            details.append(f"variants.{idx}: Expected object, received ...")
            continue
        name = variant.get("name")
        if name is None or not isinstance(name, str) or len(name) < 1:
            details.append(f"variants.{idx}.name: String must contain at least 1 character(s)")
        values = variant.get("values")
        if not isinstance(values, list) or not values:
            details.append(f"variants.{idx}.values: Array must contain at least 1 element(s)")
        else:
            for v in values:
                if not isinstance(v, str) or len(v) < 1:
                    details.append(f"variants.{idx}.values: String must contain at least 1 character(s)")
        cleaned.append({"name": name, "values": values if isinstance(values, list) else []})
    return cleaned


def _clean_images(value, details):
    if value is None:
        return None
    if not isinstance(value, list):
        details.append("images: Expected array, received ...")
        return []
    if len(value) > 20:
        details.append("images: Array must contain at most 20 element(s)")
    cleaned = []
    for url in value:
        if not isinstance(url, str) or len(url) < 1:
            details.append("images: String must contain at least 1 character(s)")
            continue
        if len(url) > 5000:
            details.append("images: String must contain at most 5000 character(s)")
            continue
        if not (re.match(r"^https?://", url) or url.startswith("/") or url.startswith("data:image/")):
            details.append("images: Images must be an uploaded file path or a valid URL")
            continue
        cleaned.append(url)
    return cleaned


def _check_item_fields(payload, update=False):
    details = []
    out = {}

    title = payload.get("title")
    out["title"] = _clean_named_string("title", title, 200, details, required=not update)

    description = payload.get("description")
    if description is None and not update:
        description = ""
    out["description"] = _clean_named_string("description", description, 2000, details)

    price = payload.get("price")
    if price is not None and not _is_number(price):
        details.append("price: Expected number, received ...")
    elif price is not None and price <= 0:
        details.append("price: Price must be positive")
    out["price"] = price

    if "sale_price" in payload:
        sale_price = payload.get("sale_price")
        out["sale_price"] = _clean_optional_number("sale_price", sale_price, details)
    else:
        out["sale_price"] = "SKIP" if update else None

    if "sale_ends_at" in payload:
        out["sale_ends_at"] = payload.get("sale_ends_at")
    else:
        out["sale_ends_at"] = "SKIP" if update else None

    category = payload.get("category")
    out["category"] = _clean_named_string("category", category, None, details, required=not update)

    condition = payload.get("condition")
    if condition is None and not update:
        condition = "good"
    out["condition"] = _clean_named_string("condition", condition, None, details)

    out["images"] = _clean_images(payload.get("images"), details)

    out["location"] = _clean_location(payload.get("location"), details)

    quantity = payload.get("quantity")
    if quantity is None and not update:
        quantity = 1
    if quantity is not None and not _is_number(quantity):
        details.append("quantity: Expected number, received ...")
    elif quantity is not None and (float(quantity) != int(quantity) or quantity <= 0):
        details.append("quantity: Number must be greater than 0")
    out["quantity"] = quantity

    currency = payload.get("currency")
    if currency is None and not update:
        currency = "NGN"
    if currency is not None and not is_valid_currency(currency):
        details.append("currency: Unsupported currency")
    out["currency"] = currency

    out["variants"] = _clean_variants(payload.get("variants"), details)

    boosted = payload.get("boosted")
    if boosted is None and not update:
        boosted = False
    if boosted is not None and not isinstance(boosted, bool):
        details.append("boosted: Expected boolean, received ...")
    out["boosted"] = boosted

    if "boost_expires_at" in payload:
        out["boost_expires_at"] = payload.get("boost_expires_at")
    else:
        out["boost_expires_at"] = "SKIP" if update else None

    is_auction = payload.get("is_auction")
    if is_auction is None and not update:
        is_auction = False
    if is_auction is not None and not isinstance(is_auction, bool):
        details.append("is_auction: Expected boolean, received ...")
    out["is_auction"] = is_auction

    if "starting_bid" in payload:
        out["starting_bid"] = _clean_optional_number("starting_bid", payload.get("starting_bid"), details)
    else:
        out["starting_bid"] = "SKIP" if update else None

    if "min_increment" in payload:
        out["min_increment"] = _clean_optional_number("min_increment", payload.get("min_increment"), details)
    else:
        out["min_increment"] = "SKIP" if update else None

    if "auction_ends_at" in payload:
        out["auction_ends_at"] = payload.get("auction_ends_at")
    else:
        out["auction_ends_at"] = "SKIP" if update else None

    status = payload.get("status")
    if status is None and not update:
        status = "active"
    if status is not None and status not in ITEM_STATUSES:
        details.append(f"status: Invalid enum value. Expected {' | '.join(ITEM_STATUSES)}, received {status}")
    out["status"] = status

    return out, details


def _item_with_images(row):
    row = dict(row)
    row["images"] = _images_for(row["id"])
    return row


@router.get("")
def list_items(
    category: str | None = None,
    sort: str = "newest",
    search: str | None = None,
    max_distance: float | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    condition: str | None = None,
    page: int = 1,
    limit: int = 20,
    seller_id: str | None = None,
    user: dict | None = Depends(optional_user),
):
    where = []
    where_params = []

    where.append("i.status = 'active'")

    if search:
        where.append("(i.title LIKE ? OR i.description LIKE ?)")
        where_params.append(f"%{search}%")
        where_params.append(f"%{search}%")

    if category and category != "all":
        where.append("LOWER(i.category) = LOWER(?)")
        where_params.append(category)

    if seller_id:
        where.append("i.seller_id = ?")
        where_params.append(seller_id)

    if min_price is not None:
        where.append("i.price >= ?")
        where_params.append(float(min_price))

    if max_price is not None:
        where.append("i.price <= ?")
        where_params.append(float(max_price))

    if condition:
        where.append("LOWER(i.condition) = LOWER(?)")
        where_params.append(condition)

    where_clause = f" WHERE {' AND '.join(where)}" if where else ""

    select_part = (
        "SELECT i.*, u.name as seller_name, u.avatar as seller_avatar, "
        "u.rating as seller_rating, u.verified as seller_verified, "
        "u.identity_verified as seller_identity_verified, "
        "COALESCE(s.plan, 'free') as seller_plan "
        "FROM items i JOIN users u ON i.seller_id = u.id "
        "LEFT JOIN subscriptions s ON s.user_id = u.id"
    )

    has_location = bool(user and user.get("location_lat") and user.get("location_lng"))

    if sort == "newest":
        order = " ORDER BY i.created_at DESC"
    elif sort == "oldest":
        order = " ORDER BY i.created_at ASC"
    elif sort == "price_low":
        order = " ORDER BY i.price ASC"
    elif sort == "price_high":
        order = " ORDER BY i.price DESC"
    elif sort == "popular":
        order = " ORDER BY i.views DESC, i.favorites DESC"
    elif sort == "nearest":
        if has_location:
            select_part = select_part.replace("SELECT i.*", f"SELECT i.*, ({DISTANCE_EXPR}) as distance")
            order = " ORDER BY distance ASC"
            nearest_params = [
                float(user["location_lat"]),
                float(user["location_lat"]),
                float(user["location_lng"]),
            ]
        else:
            order = " ORDER BY i.created_at DESC"
    else:
        order = " ORDER BY i.boosted DESC, i.created_at DESC"

    query = select_part + where_clause + order + " LIMIT ? OFFSET ?"

    if sort == "nearest" and has_location:
        params = [*nearest_params, *where_params, limit, (page - 1) * limit]
    else:
        params = [*where_params, limit, (page - 1) * limit]

    items = db.all(query, tuple(params))

    enriched = []
    for item in items:
        item = dict(item)
        item["images"] = _images_for(item["id"])
        if user and item.get("location_lat") and item.get("location_lng"):
            item["distance"] = _distance(
                float(user["location_lat"]), float(user["location_lng"]),
                float(item["location_lat"]), float(item["location_lng"]),
            )
        is_fav = bool(user) and db.get(
            "SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?",
            (user["id"], item["id"]),
        )
        item["is_favorite"] = bool(is_fav)
        item["sale_active"] = _sale_active(item)
        enriched.append(item)

    if max_distance is not None and user:
        filtered = [i for i in enriched if i.get("distance") and i["distance"] <= max_distance]
        return {
            "items": filtered[(page - 1) * limit : (page - 1) * limit + limit],
            "total": len(filtered),
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(len(filtered) / limit) if filtered else 0,
        }

    total = db.get("SELECT COUNT(*) as count FROM items i" + where_clause, tuple(where_params))["count"]
    return {
        "items": enriched,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": math.ceil(total / limit) if total else 0,
    }


@router.get("/user/{user_id}/drafts")
def get_drafts(user_id: str, user: dict = Depends(require_user)):
    if user["id"] != user_id:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    rows = db.all(
        "SELECT * FROM items WHERE seller_id = ? AND status = ? ORDER BY updated_at DESC",
        (user_id, "draft"),
    )
    return {"items": [_item_with_images(r) for r in rows]}


@router.get("/user/{user_id}")
def get_user_items(user_id: str):
    rows = db.all(
        "SELECT i.*, u.name as seller_name, u.avatar as seller_avatar "
        "FROM items i JOIN users u ON i.seller_id = u.id "
        "WHERE i.seller_id = ? AND i.status != 'draft' ORDER BY i.created_at DESC",
        (user_id,),
    )
    return {"items": [_item_with_images(r) for r in rows]}


@router.get("/categories/overview")
def categories_overview():
    rows = db.all(
        "SELECT category, COUNT(*) as count, AVG(price) as avg_price "
        "FROM items WHERE status = 'active' GROUP BY category ORDER BY count DESC"
    )
    return {"categories": rows}


@router.get("/{item_id}")
def get_item(item_id: str, user: dict | None = Depends(optional_user)):
    item = db.get(
        "SELECT i.*, u.name as seller_name, u.avatar as seller_avatar, u.rating as seller_rating, "
        "u.review_count as seller_review_count, u.verified as seller_verified, "
        "u.identity_verified as seller_identity_verified, u.bio as seller_bio, "
        "u.created_at as seller_joined "
        "FROM items i JOIN users u ON i.seller_id = u.id WHERE i.id = ?",
        (item_id,),
    )
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})

    item = dict(item)
    item["images"] = _images_for(item["id"])

    variants = db.all("SELECT name, variant_values FROM item_variants WHERE item_id = ?", (item["id"],))
    item["variants"] = [{"name": v["name"], "values": json.loads(v["variant_values"])} for v in variants]

    db.run("UPDATE items SET views = views + 1 WHERE id = ?", (item["id"],))

    if user and item.get("location_lat") and item.get("location_lng"):
        item["distance"] = _distance(
            float(user["location_lat"]), float(user["location_lng"]),
            float(item["location_lat"]), float(item["location_lng"]),
        )

    is_fav = bool(user) and db.get(
        "SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?", (user["id"], item["id"])
    )
    item["is_favorite"] = bool(is_fav)
    item["sale_active"] = _sale_active(item)

    item["similar_items"] = db.all(
        "SELECT i.id, i.title, i.price, i.sale_price, "
        "(SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) as image "
        "FROM items i WHERE i.category = ? AND i.id != ? AND i.status = 'active' "
        "ORDER BY i.created_at DESC LIMIT 6",
        (item["category"], item["id"]),
    )

    return {"item": item}


@router.post("", status_code=201)
def create_item(
    body: dict = Body(...),
    user: dict = Depends(require_user),
):
    out, details = _check_item_fields(body)
    if details:
        raise_validation(details)

    item_id = str(uuid.uuid4())
    auction = out["is_auction"] is True
    starting_bid = out["starting_bid"] if out["starting_bid"] is not None else out["price"]
    location = out["location"] or {}

    db.run(
        "INSERT INTO items (id, title, description, price, sale_price, sale_ends_at, category, condition, "
        "seller_id, location_lat, location_lng, location_address, quantity, currency, boosted, "
        "boost_expires_at, is_auction, starting_bid, min_increment, auction_ends_at, auction_status, "
        "current_bid, current_bidder_id, status) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            item_id,
            out["title"],
            out["description"] or "",
            out["price"],
            out["sale_price"] or None,
            out["sale_ends_at"] or None,
            out["category"],
            out["condition"],
            user["id"],
            (location.get("lat") if location.get("lat") is not None else None),
            (location.get("lng") if location.get("lng") is not None else None),
            location.get("address") or "",
            out["quantity"] or 1,
            out["currency"] or "NGN",
            1 if out["boosted"] is True else 0,
            out["boost_expires_at"] or None,
            1 if auction else 0,
            starting_bid if auction else None,
            (out["min_increment"] or 1) if auction else None,
            (out["auction_ends_at"] or None) if auction else None,
            "active" if auction else "pending",
            starting_bid if auction else None,
            None,
            out["status"] or "active",
        ),
    )

    images = out["images"] or []
    for i, url in enumerate(images):
        db.run(
            "INSERT INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), item_id, url, i),
        )

    variants = out["variants"] or []
    for v in variants:
        db.run(
            "INSERT INTO item_variants (id, item_id, name, variant_values) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), item_id, v.get("name"), json.dumps(v.get("values") or [])),
        )

    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    item = _item_with_images(item)

    notify(user["id"], "system", "Listing Created", f'"{out["title"]}" is now live!')

    db.run(
        "INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), None, "item_created", "item", item_id, json.dumps({"title": out["title"]})),
    )

    return {"item": item}


@router.put("/{item_id}")
def update_item(
    item_id: str,
    body: dict = Body(...),
    user: dict = Depends(require_user),
):
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    out, details = _check_item_fields(body, update=True)
    if details:
        raise_validation(details)

    def pick(field):
        value = out[field]
        return item[field] if value == "SKIP" else value

    def pick_opt(field):
        value = out[field]
        return item[field] if value == "SKIP" else value

    location = out["location"]
    if location is None:
        loc_lat, loc_lng, loc_addr = item["location_lat"], item["location_lng"], item["location_address"]
    else:
        loc_lat = location.get("lat") if location.get("lat") is not None else item["location_lat"]
        loc_lng = location.get("lng") if location.get("lng") is not None else item["location_lng"]
        loc_addr = location.get("address") if location.get("address") is not None else item["location_address"]

    sale_price = item["sale_price"] if out["sale_price"] == "SKIP" else (out["sale_price"] or None)
    sale_ends_at = item["sale_ends_at"] if out["sale_ends_at"] == "SKIP" else out["sale_ends_at"]
    boost_expires = item["boost_expires_at"] if out["boost_expires_at"] == "SKIP" else out["boost_expires_at"]
    starting_bid = item["starting_bid"] if out["starting_bid"] == "SKIP" else out["starting_bid"]
    min_increment = item["min_increment"] if out["min_increment"] == "SKIP" else (out["min_increment"] or 1)
    auction_ends = item["auction_ends_at"] if out["auction_ends_at"] == "SKIP" else out["auction_ends_at"]
    auction_status = item["auction_status"]

    db.run(
        "UPDATE items SET title = ?, description = ?, price = ?, sale_price = ?, sale_ends_at = ?, "
        "category = ?, condition = ?, location_lat = ?, location_lng = ?, location_address = ?, "
        "quantity = ?, status = ?, boosted = ?, boost_expires_at = ?, updated_at = datetime('now'), "
        "is_auction = ?, starting_bid = ?, min_increment = ?, auction_ends_at = ?, auction_status = ?, "
        "currency = ? WHERE id = ?",
        (
            out["title"] if out["title"] is not None else item["title"],
            out["description"] if out["description"] is not None else item["description"],
            out["price"] if out["price"] is not None else item["price"],
            sale_price,
            sale_ends_at,
            out["category"] if out["category"] is not None else item["category"],
            out["condition"] if out["condition"] is not None else item["condition"],
            loc_lat,
            loc_lng,
            loc_addr,
            out["quantity"] if out["quantity"] is not None else item["quantity"],
            out["status"] if out["status"] is not None else item["status"],
            (1 if out["boosted"] is True else 0) if out["boosted"] is not None else item["boosted"],
            boost_expires,
            (1 if out["is_auction"] is True else 0) if out["is_auction"] is not None else item["is_auction"],
            starting_bid,
            min_increment,
            auction_ends,
            auction_status,
            out["currency"] if out["currency"] is not None else item["currency"],
            item_id,
        ),
    )

    if out["images"] is not None:
        db.run("DELETE FROM item_images WHERE item_id = ?", (item_id,))
        for i, url in enumerate(out["images"]):
            db.run(
                "INSERT INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), item_id, url, i),
            )

    if out["variants"] is not None:
        db.run("DELETE FROM item_variants WHERE item_id = ?", (item_id,))
        for v in out["variants"]:
            db.run(
                "INSERT INTO item_variants (id, item_id, name, variant_values) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), item_id, v.get("name"), json.dumps(v.get("values") or [])),
            )

    updated = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    return {"item": _item_with_images(updated)}


@router.delete("/{item_id}")
def delete_item(item_id: str, user: dict = Depends(require_user)):
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    db.run("DELETE FROM items WHERE id = ?", (item_id,))
    notify(user["id"], "system", "Listing Deleted", f'"{item["title"]}" has been removed.')
    return {"success": True}


@router.put("/bulk/update")
def bulk_update(body: dict = Body(...), user: dict = Depends(require_user)):
    ids = body.get("ids")
    updates = body.get("updates")
    if not isinstance(ids, list) or len(ids) == 0:
        raise HTTPException(status_code=400, detail={"error": "ids is required"})
    if len(ids) > 50:
        raise HTTPException(status_code=400, detail={"error": "Maximum of 50 items per bulk operation"})
    if not isinstance(updates, dict):
        raise HTTPException(status_code=400, detail={"error": "updates is required"})

    placeholders = ",".join("?" for _ in ids)
    owned = db.all(
        f"SELECT id, title, status FROM items WHERE id IN ({placeholders}) AND seller_id = ?",
        (*ids, user["id"]),
    )
    if len(owned) == 0:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    allowed = ("price", "sale_price", "category", "condition", "quantity", "status")
    changes = {k: updates[k] for k in allowed if k in updates}
    if not changes:
        raise HTTPException(status_code=400, detail={"error": "No valid fields to update"})

    sets = ", ".join(f"{k} = ?" for k in changes)
    vals = [changes[k] if changes[k] is not None else None for k in changes]
    for item in owned:
        db.run(f"UPDATE items SET {sets}, updated_at = datetime('now') WHERE id = ?", (*vals, item["id"]))

    return {"success": True, "updated": len(owned), "items": owned}


@router.post("/bulk/delete")
def bulk_delete(body: dict = Body(...), user: dict = Depends(require_user)):
    ids = body.get("ids")
    if not isinstance(ids, list) or len(ids) == 0:
        raise HTTPException(status_code=400, detail={"error": "ids is required"})
    if len(ids) > 50:
        raise HTTPException(status_code=400, detail={"error": "Maximum of 50 items per bulk operation"})

    placeholders = ",".join("?" for _ in ids)
    owned = db.all(
        f"SELECT id, title FROM items WHERE id IN ({placeholders}) AND seller_id = ?",
        (*ids, user["id"]),
    )
    if len(owned) == 0:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    db.run(f"DELETE FROM items WHERE id IN ({placeholders}) AND seller_id = ?", (*ids, user["id"]))

    for item in owned:
        notify(user["id"], "system", "Listing Deleted", f'"{item["title"]}" has been removed.')

    return {"success": True, "deleted": len(owned)}


@router.post("/{item_id}/favorite")
def toggle_favorite(item_id: str, user: dict = Depends(require_user)):
    item = db.get("SELECT id, price, sale_price FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})

    existing = db.get(
        "SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?", (user["id"], item_id)
    )
    if existing:
        db.run("DELETE FROM favorites WHERE user_id = ? AND item_id = ?", (user["id"], item_id))
        db.run("UPDATE items SET favorites = MAX(0, favorites - 1) WHERE id = ?", (item_id,))
        return {"favorited": False}

    price_at_add = item["sale_price"] if item["sale_price"] is not None else item["price"]
    db.run(
        "INSERT INTO favorites (user_id, item_id, price_at_add) VALUES (?, ?, ?)",
        (user["id"], item_id, price_at_add),
    )
    db.run("UPDATE items SET favorites = favorites + 1 WHERE id = ?", (item_id,))
    return {"favorited": True}


@router.get("/{item_id}/bids")
def get_bids(item_id: str):
    item = db.get("SELECT id, is_auction FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if not item["is_auction"]:
        raise HTTPException(status_code=400, detail={"error": "Item is not an auction"})

    bids = db.all(
        "SELECT b.id, b.amount, b.created_at, u.name as bidder_name, u.avatar as bidder_avatar "
        "FROM bids b JOIN users u ON b.bidder_id = u.id "
        "WHERE b.item_id = ? ORDER BY b.amount DESC LIMIT 50",
        (item_id,),
    )
    return {"bids": bids}


@router.post("/{item_id}/bid", status_code=201)
def place_bid(item_id: str, body: dict = Body(...), user: dict = Depends(require_user)):
    amount = body.get("amount")
    if not _is_number(amount) or amount <= 0:
        raise HTTPException(status_code=400, detail={"error": "Validation failed", "details": ["amount: Bid must be positive"]})

    item = db.get(
        "SELECT id, seller_id, is_auction, starting_bid, min_increment, current_bid, "
        "current_bidder_id, auction_ends_at, auction_status, status, currency FROM items WHERE id = ?",
        (item_id,),
    )
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if not item["is_auction"]:
        raise HTTPException(status_code=400, detail={"error": "Item is not an auction"})
    if item["status"] != "active" or item["auction_status"] != "active":
        raise HTTPException(status_code=400, detail={"error": "Auction is not accepting bids"})
    if item["seller_id"] == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "You cannot bid on your own auction"})

    ends = parse_iso(item["auction_ends_at"])
    if ends and ends <= utc_now():
        raise HTTPException(status_code=400, detail={"error": "Auction has ended"})

    current_bid = item["current_bid"] if item["current_bid"] is not None else (
        item["starting_bid"] if item["starting_bid"] is not None else 0
    )
    min_bid = current_bid + (item["min_increment"] or 1)
    if amount < min_bid:
        raise HTTPException(
            status_code=400,
            detail={"error": f"Bid must be at least {format_money(min_bid, item['currency'] or 'NGN')}"},
        )

    bid_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO bids (id, item_id, bidder_id, amount) VALUES (?, ?, ?, ?)",
        (bid_id, item["id"], user["id"], amount),
    )
    db.run("UPDATE items SET current_bid = ?, current_bidder_id = ? WHERE id = ?", (amount, user["id"], item["id"]))

    if item["current_bidder_id"] and item["current_bidder_id"] != user["id"]:
        db.run(
            "INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, 'system', ?, ?, ?)",
            (
                str(uuid.uuid4()),
                item["current_bidder_id"],
                "You've been outbid",
                f"A new bid of {format_money(amount, item['currency'] or 'NGN')} was placed on your auction item.",
                json.dumps({"itemId": item["id"]}),
            ),
        )

    return {"bid": db.get("SELECT * FROM bids WHERE id = ?", (bid_id,)), "current_bid": amount}


@router.get("/{item_id}/related")
def related_items(item_id: str):
    item = db.get("SELECT category, id FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})

    related = db.all(
        "SELECT i.id, i.title, i.price, i.sale_price, i.created_at, "
        "(SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) as image "
        "FROM items i WHERE i.category = ? AND i.id != ? AND i.status = 'active' "
        "ORDER BY i.created_at DESC LIMIT 8",
        (item["category"], item["id"]),
    )
    return {"items": related}


@router.post("/{item_id}/mark-sold")
def mark_sold(item_id: str, user: dict = Depends(require_user)):
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    db.run("UPDATE items SET status = 'sold', updated_at = datetime('now') WHERE id = ?", (item_id,))
    return {"success": True, "status": "sold"}


@router.post("/{item_id}/relist")
def relist(item_id: str, user: dict = Depends(require_user)):
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    if item["status"] != "sold":
        raise HTTPException(status_code=400, detail={"error": "Only sold items can be relisted"})

    db.run("UPDATE items SET status = 'active', updated_at = datetime('now') WHERE id = ?", (item_id,))
    return {"success": True, "status": "active"}


@router.get("/premium/sellers")
def premium_sellers():
    sellers = db.all(
        "SELECT u.id, u.name, u.avatar, u.rating, u.review_count, u.verified, s.plan, s.status "
        "FROM users u JOIN subscriptions s ON s.user_id = u.id "
        "WHERE s.plan IN ('premium', 'pro') AND s.status = 'active' ORDER BY u.rating DESC LIMIT 10"
    )

    enriched = []
    for seller in sellers:
        seller = dict(seller)
        seller["items"] = db.all(
            "SELECT i.id, i.title, i.price, i.sale_price, "
            "(SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) as image "
            "FROM items i WHERE i.seller_id = ? AND i.status = 'active' "
            "ORDER BY i.created_at DESC LIMIT 3",
            (seller["id"],),
        )
        seller["badge"] = "Pro Seller" if seller["plan"] == "pro" else "Premium Seller"
        enriched.append(seller)

    return {"sellers": enriched}