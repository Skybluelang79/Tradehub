import json
import logging
import math
import re
import uuid
from datetime import timedelta

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..currencies import format_money, is_valid_currency
from ..datetime_util import parse_iso, utc_now
from ..deps import optional_user, require_user
from ..moderation import has_offplatform_contact
from ..notifications import notify
from ..plans import get_effective_plan, get_plan
from ..search import match as search_match
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


def _future_sql_date(days):
    return (utc_now() + timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")


def _float_or_none(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _seller_plan(user_id):
    sub = db.get(
        "SELECT plan, status, trial_end, current_period_end FROM subscriptions WHERE user_id = ?",
        (user_id,),
    )
    return get_plan(get_effective_plan(sub))


def _count_published_listings(user_id, exclude_id=None):
    if exclude_id:
        row = db.get(
            "SELECT COUNT(*) as count FROM items WHERE seller_id = ? AND id != ? "
            "AND status IN ('active', 'pending', 'reserved')",
            (user_id, exclude_id),
        )
    else:
        row = db.get(
            "SELECT COUNT(*) as count FROM items WHERE seller_id = ? "
            "AND status IN ('active', 'pending', 'reserved')",
            (user_id,),
        )
    return row["count"]


def _count_featured_listings(user_id, exclude_id=None):
    if exclude_id:
        row = db.get(
            "SELECT COUNT(*) as count FROM items WHERE seller_id = ? AND id != ? AND boosted = 1 "
            "AND (boost_expires_at IS NULL OR boost_expires_at > datetime('now'))",
            (user_id, exclude_id),
        )
    else:
        row = db.get(
            "SELECT COUNT(*) as count FROM items WHERE seller_id = ? AND boosted = 1 "
            "AND (boost_expires_at IS NULL OR boost_expires_at > datetime('now'))",
            (user_id,),
        )
    return row["count"]


def _listing_limit_error(plan):
    return (
        f"Your {plan['name']} plan allows {plan['maxListings']} active listings. "
        "Upgrade to Gold for 120."
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
        options = variant.get("options")
        values = variant.get("values")
        entries = values if isinstance(values, list) and values else options
        if not isinstance(entries, list) or not entries:
            details.append(f"variants.{idx}.values: Array must contain at least 1 element(s)")
            entries = []
        normalized_values = []
        normalized_options = []
        seen = set()
        for option_idx, entry in enumerate(entries):
            stock = 1
            price_cents = None
            sku = ""
            if isinstance(entry, str):
                option_value = entry
            elif isinstance(entry, dict):
                option_value = entry.get("value") or entry.get("name")
                raw_stock = entry.get("stock")
                if raw_stock is not None:
                    if not _is_number(raw_stock) or float(raw_stock) != int(raw_stock) or raw_stock < 0:
                        details.append(
                            f"variants.{idx}.options.{option_idx}.stock: Stock must be zero or greater"
                        )
                    else:
                        stock = int(raw_stock)
                raw_price = entry.get("priceCents")
                if raw_price is None and entry.get("price") is not None:
                    try:
                        raw_price = round(float(entry.get("price")) * 100)
                    except (TypeError, ValueError):
                        raw_price = None
                if raw_price is not None:
                    if not _is_number(raw_price) or raw_price < 0:
                        details.append(
                            f"variants.{idx}.options.{option_idx}.price: Price must be zero or greater"
                        )
                    else:
                        price_cents = int(round(raw_price))
                sku = str(entry.get("sku") or "").strip()[:64]
            else:
                details.append(f"variants.{idx}.values.{option_idx}: Expected string or object")
                continue
            if not isinstance(option_value, str) or len(option_value.strip()) < 1:
                details.append(
                    f"variants.{idx}.values.{option_idx}: String must contain at least 1 character(s)"
                )
                continue
            option_value = option_value.strip()[:80]
            if option_value.lower() in seen:
                details.append(f"variants.{idx}.values: Duplicate value \"{option_value}\"")
                continue
            seen.add(option_value.lower())
            normalized_values.append(option_value)
            normalized_options.append({
                "value": option_value,
                "sku": sku,
                "price_cents": price_cents,
                "stock": stock,
            })
        cleaned.append({
            "name": str(name or "").strip()[:80],
            "values": normalized_values,
            "options": normalized_options,
        })
    return cleaned


def _clean_cents(field, value, details, default=0):
    if value is None or value == "":
        return default
    if not _is_number(value) or float(value) != int(value) or value < 0:
        details.append(f"{field}: Amount must be zero or greater")
        return default
    return int(value)


def _save_variants(item_id, variants):
    db.run("DELETE FROM item_variant_options WHERE item_id = ?", (item_id,))
    db.run("DELETE FROM item_variants WHERE item_id = ?", (item_id,))
    for variant in variants or []:
        db.run(
            "INSERT INTO item_variants (id, item_id, name, variant_values) VALUES (?, ?, ?, ?)",
            (
                str(uuid.uuid4()), item_id, variant.get("name"),
                json.dumps(variant.get("values") or []),
            ),
        )
        for option in variant.get("options") or []:
            db.run(
                """
                INSERT INTO item_variant_options (
                  id, item_id, variant_name, value, sku, price_cents, stock
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()), item_id, variant.get("name"), option.get("value"),
                    option.get("sku") or "", option.get("price_cents"), int(option.get("stock") or 0),
                ),
            )


def _variant_options_for(item_id):
    return db.all(
        "SELECT id, variant_name, value, sku, price_cents, stock "
        "FROM item_variant_options WHERE item_id = ? ORDER BY variant_name, rowid",
        (item_id,),
    )


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
    if isinstance(out["description"], str) and has_offplatform_contact(out["description"]):
        details.append("description: Remove phone numbers, WhatsApp links and social handles")

    price = payload.get("price")
    if price is None and not update:
        details.append("price: Price is required")
    elif price is not None and not _is_number(price):
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

    if "video_url" in payload:
        video_url = payload.get("video_url")
        if video_url is None or video_url == "":
            out["video_url"] = None
        elif not isinstance(video_url, str):
            details.append("video_url: Expected string, received ...")
            out["video_url"] = None
        elif len(video_url) > 25_000_000:
            details.append("video_url: String must contain at most 25000000 character(s)")
            out["video_url"] = None
        elif not (
            re.match(r"^https?://", video_url)
            or video_url.startswith("/")
            or video_url.startswith("data:video/")
        ):
            details.append("video_url: Video must be an uploaded file path or a valid URL")
            out["video_url"] = None
        else:
            out["video_url"] = video_url
    else:
        out["video_url"] = "SKIP" if update else None

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

    fee_present = "shipping_fee_cents" in payload or "shippingFeeCents" in payload
    fee_value = payload.get("shipping_fee_cents", payload.get("shippingFeeCents"))
    out["shipping_fee_cents"] = (
        _clean_cents("shipping_fee_cents", fee_value, details)
        if fee_present else ("SKIP" if update else 0)
    )

    threshold_present = (
        "free_shipping_threshold_cents" in payload
        or "freeShippingThresholdCents" in payload
    )
    threshold_value = payload.get(
        "free_shipping_threshold_cents", payload.get("freeShippingThresholdCents")
    )
    out["free_shipping_threshold_cents"] = (
        _clean_cents("free_shipping_threshold_cents", threshold_value, details)
        if threshold_present else ("SKIP" if update else 0)
    )

    pickup_present = "pickup_available" in payload or "pickupAvailable" in payload
    pickup = payload.get("pickup_available", payload.get("pickupAvailable"))
    if pickup is not None and not isinstance(pickup, bool):
        details.append("pickup_available: Expected boolean")
        pickup = None
    out["pickup_available"] = (
        (True if pickup is None else pickup) if pickup_present else ("SKIP" if update else True)
    )

    processing_present = "processing_days" in payload or "processingDays" in payload
    processing = payload.get("processing_days", payload.get("processingDays"))
    if processing is not None:
        if not _is_number(processing) or float(processing) != int(processing) or not (1 <= processing <= 60):
            details.append("processing_days: Expected a whole number between 1 and 60")
        else:
            processing = int(processing)
    out["processing_days"] = (
        (processing or 2) if processing_present else ("SKIP" if update else 2)
    )

    notes_present = "shipping_notes" in payload or "shippingNotes" in payload
    notes = payload.get("shipping_notes", payload.get("shippingNotes"))
    if notes is not None and (not isinstance(notes, str) or len(notes) > 500):
        details.append("shipping_notes: String must contain at most 500 characters")
        notes = ""
    out["shipping_notes"] = (
        str(notes or "").strip() if notes_present else ("SKIP" if update else "")
    )

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

    is_distress = payload.get("is_distress")
    if is_distress is None and not update:
        is_distress = False
    if is_distress is not None and not isinstance(is_distress, bool):
        details.append("is_distress: Expected boolean, received ...")
    out["is_distress"] = is_distress

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
    q: str | None = None,
    max_distance: float | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    condition: str | None = None,
    conditions: str | None = None,
    brand: str | None = None,
    size: str | None = None,
    min_rating: float | None = None,
    attributes: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    page: int = 1,
    limit: int = 20,
    seller_id: str | None = None,
    user: dict | None = Depends(optional_user),
):
    page = max(1, int(page))
    limit = max(1, min(int(limit), 100))
    search_term = str(search or q or "").strip()

    where = ["i.status = 'active'"]
    where_params = []
    fts_join = ""
    search_rank = None

    if search_term:
        fts = search_match(search_term)
        if fts:
            fts_join = fts["join"]
            where.append(fts["where"])
            where_params.extend(fts["params"])
            search_rank = fts["rank"]
        else:
            where.append("(i.title LIKE ? OR i.description LIKE ?)")
            where_params.extend([f"%{search_term}%", f"%{search_term}%"])

    if category and category != "all":
        where.append("LOWER(i.category) = LOWER(?)")
        where_params.append(category)

    if seller_id:
        where.append("i.seller_id = ?")
        where_params.append(seller_id)

    min_price_value = _float_or_none(min_price)
    if min_price_value is not None:
        where.append("i.price >= ?")
        where_params.append(min_price_value)

    max_price_value = _float_or_none(max_price)
    if max_price_value is not None:
        where.append("i.price <= ?")
        where_params.append(max_price_value)

    condition_values = []
    if conditions:
        condition_values = [
            value.strip().lower()
            for value in str(conditions).split(",")
            if value.strip()
        ]
    elif condition and condition != "all":
        condition_values = [str(condition).strip().lower()]
    condition_values = list(dict.fromkeys(condition_values))
    if condition_values:
        placeholders = ", ".join("?" for _ in condition_values)
        where.append(f"LOWER(i.condition) IN ({placeholders})")
        where_params.extend(condition_values)

    def add_attribute_filter(name, value):
        clean_name = str(name or "").strip()
        clean_value = str(value or "").strip()
        if not clean_name or not clean_value:
            return
        where.append(
            "EXISTS (SELECT 1 FROM listing_attributes la WHERE la.item_id = i.id "
            "AND LOWER(la.name) = LOWER(?) AND LOWER(la.value) = LOWER(?))"
        )
        where_params.extend([clean_name, clean_value])

    add_attribute_filter("brand", brand)
    add_attribute_filter("size", size)

    if attributes:
        try:
            parsed_attributes = json.loads(attributes)
        except Exception:
            parsed_attributes = None
        if isinstance(parsed_attributes, dict):
            for name, value in list(parsed_attributes.items())[:20]:
                add_attribute_filter(name, value)

    min_rating_value = _float_or_none(min_rating)
    if min_rating_value is not None:
        where.append("COALESCE(u.rating, 0) >= ?")
        where_params.append(min_rating_value)

    origin_lat = _float_or_none(lat)
    origin_lng = _float_or_none(lng)
    if origin_lat is None and user:
        origin_lat = _float_or_none(user.get("location_lat"))
    if origin_lng is None and user:
        origin_lng = _float_or_none(user.get("location_lng"))
    has_location = origin_lat is not None and origin_lng is not None

    max_distance_value = _float_or_none(max_distance)
    if max_distance_value is not None and max_distance_value < 0:
        max_distance_value = None

    where_clause = f" WHERE {' AND '.join(where)}"
    from_clause = (
        " FROM items i JOIN users u ON i.seller_id = u.id "
        "LEFT JOIN subscriptions s ON s.user_id = u.id"
        + fts_join
    )

    select_columns = [
        "i.*",
        "u.name as seller_name",
        "u.avatar as seller_avatar",
        "u.rating as seller_rating",
        "u.verified as seller_verified",
        "u.identity_verified as seller_identity_verified",
        "COALESCE(s.plan, 'free') as seller_plan",
    ]
    select_params = []
    if has_location:
        select_columns.append(f"({DISTANCE_EXPR}) as distance")
        select_params.extend([origin_lat, origin_lat, origin_lng])
    if search_rank:
        select_columns.append(f"{search_rank} as search_rank")

    outer_where = ""
    outer_params = []
    if has_location and max_distance_value is not None:
        outer_where = " WHERE distance IS NOT NULL AND distance <= ?"
        outer_params.append(max_distance_value)

    if sort == "relevance" and search_rank:
        order = " ORDER BY is_distress DESC, search_rank ASC, boosted DESC, created_at DESC"
    elif sort == "nearest" and has_location:
        order = " ORDER BY is_distress DESC, distance ASC, created_at DESC"
    elif sort == "oldest":
        order = " ORDER BY is_distress DESC, created_at ASC"
    elif sort == "price_low":
        order = " ORDER BY is_distress DESC, price ASC"
    elif sort == "price_high":
        order = " ORDER BY is_distress DESC, price DESC"
    elif sort == "popular":
        order = " ORDER BY is_distress DESC, views DESC, favorites DESC"
    elif sort == "rating":
        order = " ORDER BY is_distress DESC, COALESCE(seller_rating, 0) DESC, created_at DESC"
    else:
        order = " ORDER BY is_distress DESC, boosted DESC, created_at DESC"

    candidates = (
        f"WITH candidates AS (SELECT {', '.join(select_columns)}{from_clause}{where_clause})"
    )
    query = (
        f"{candidates} SELECT * FROM candidates{outer_where}{order} LIMIT ? OFFSET ?"
    )
    params = [*select_params, *where_params, *outer_params, limit, (page - 1) * limit]
    items = db.all(query, tuple(params))

    enriched = []
    for item in items:
        item = dict(item)
        item["images"] = _images_for(item["id"])
        if (
            has_location
            and item.get("location_lat") is not None
            and item.get("location_lng") is not None
        ):
            item["distance"] = _distance(
                origin_lat,
                origin_lng,
                float(item["location_lat"]),
                float(item["location_lng"]),
            )
        is_fav = bool(user) and db.get(
            "SELECT 1 FROM favorites WHERE user_id = ? AND item_id = ?",
            (user["id"], item["id"]),
        )
        item["is_favorite"] = bool(is_fav)
        item["sale_active"] = _sale_active(item)
        enriched.append(item)

    count_columns = ["i.id"]
    count_params = []
    if has_location:
        count_columns.append(f"({DISTANCE_EXPR}) as distance")
        count_params.extend([origin_lat, origin_lat, origin_lng])
    count_candidates = (
        f"WITH candidates AS (SELECT {', '.join(count_columns)}{from_clause}{where_clause})"
    )
    count_query = f"{count_candidates} SELECT COUNT(*) as count FROM candidates{outer_where}"
    count_params.extend([*where_params, *outer_params])
    total = db.get(count_query, tuple(count_params))["count"]

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


@router.get("/favorites")
def list_favorites(user: dict = Depends(require_user)):
    rows = db.all(
        "SELECT i.*, u.name as seller_name, u.avatar as seller_avatar, "
        "u.rating as seller_rating, u.verified as seller_verified, "
        "f.price_at_add as favorite_price_at_add, f.created_at as favorited_at "
        "FROM favorites f JOIN items i ON f.item_id = i.id "
        "JOIN users u ON i.seller_id = u.id "
        "WHERE f.user_id = ? AND i.status != 'draft' ORDER BY f.created_at DESC",
        (user["id"],),
    )
    items = []
    for row in rows:
        item = _item_with_images(row)
        item["is_favorite"] = True
        item["sale_active"] = _sale_active(item)
        items.append(item)
    return {"items": items, "favorites": [item["id"] for item in items]}


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
    item["variant_options"] = _variant_options_for(item["id"])

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
    status = out["status"] or "active"
    plan = _seller_plan(user["id"])
    images = out["images"] or []

    if status != "draft":
        if plan["maxListings"] != -1 and _count_published_listings(user["id"]) >= plan["maxListings"]:
            raise HTTPException(status_code=403, detail={"error": _listing_limit_error(plan)})
        if len(images) > plan["maxPhotos"]:
            raise HTTPException(
                status_code=403,
                detail={"error": f"{plan['name']} plan allows up to {plan['maxPhotos']} photos per listing."},
            )
        if out["video_url"] and plan["maxVideos"] < 1:
            raise HTTPException(
                status_code=403,
                detail={"error": "Listing videos are a Gold subscription benefit."},
            )
        if out["boosted"] and _count_featured_listings(user["id"]) >= plan["featuredSlots"]:
            raise HTTPException(
                status_code=403,
                detail={"error": f"{plan['name']} plan allows {plan['featuredSlots']} featured slots."},
            )

    listing_status = (
        "pending" if auction and status != "draft" and not plan["auctionAutoApprove"] else status
    )
    expires_at = None if listing_status == "draft" else _future_sql_date(plan["listingDays"])
    distress = 1 if plan["distressPinned"] and out["is_distress"] else 0

    db.run(
        "INSERT INTO items (id, title, description, price, sale_price, sale_ends_at, category, condition, "
        "seller_id, location_lat, location_lng, location_address, quantity, currency, boosted, "
        "boost_expires_at, is_auction, starting_bid, min_increment, auction_ends_at, auction_status, "
        "current_bid, current_bidder_id, status, expires_at, video_url, is_distress, "
        "shipping_fee_cents, free_shipping_threshold_cents, pickup_available, processing_days, shipping_notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
            listing_status,
            expires_at,
            out["video_url"] or None,
            distress,
            out["shipping_fee_cents"] or 0,
            out["free_shipping_threshold_cents"] or 0,
            1 if out["pickup_available"] is not False else 0,
            out["processing_days"] or 2,
            out["shipping_notes"] or "",
        ),
    )

    images = out["images"] or []
    for i, url in enumerate(images):
        db.run(
            "INSERT INTO item_images (id, item_id, url, sort_order) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), item_id, url, i),
        )

    _save_variants(item_id, out["variants"] or [])

    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    item = _item_with_images(item)

    notify(
        user["id"],
        "system",
        "Listing Created",
        (
            f'"{out["title"]}" is now live!'
            if listing_status == "active"
            else f'"{out["title"]}" was submitted for review. Gold sellers get auction auto-approval.'
        ),
    )

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

    if item.get("locked_at") or item["status"] == "expired":
        raise HTTPException(
            status_code=403,
            detail={"error": "This listing has expired and is locked. Renew it to make changes."},
        )

    out, details = _check_item_fields(body, update=True)
    if details:
        raise_validation(details)

    plan = _seller_plan(user["id"])
    was_auction = item["is_auction"] == 1
    enabling_auction = out["is_auction"] is True and not was_auction
    requested_status = out["status"] if out["status"] is not None else item["status"]
    publishing = requested_status == "active" and item["status"] != "active"

    if publishing and plan["maxListings"] != -1 and _count_published_listings(user["id"], item["id"]) >= plan["maxListings"]:
        raise HTTPException(status_code=403, detail={"error": _listing_limit_error(plan)})
    if out["images"] is not None and len(out["images"]) > plan["maxPhotos"]:
        raise HTTPException(
            status_code=403,
            detail={"error": f"{plan['name']} plan allows up to {plan['maxPhotos']} photos per listing."},
        )
    if out["video_url"] not in ("SKIP", None) and out["video_url"] != item["video_url"] and plan["maxVideos"] < 1:
        raise HTTPException(
            status_code=403,
            detail={"error": "Listing videos are a Gold subscription benefit."},
        )

    next_status = (
        "pending"
        if enabling_auction and not plan["auctionAutoApprove"] and requested_status == "active"
        else requested_status
    )

    boost_touched = out["boosted"] is not None or out["boost_expires_at"] != "SKIP"
    next_boosted = out["boosted"] if out["boosted"] is not None else bool(item["boosted"])
    if boost_touched and next_boosted:
        if plan["featuredSlots"] < 1:
            raise HTTPException(
                status_code=403,
                detail={"error": "Featured listings are a Gold subscription benefit."},
            )
        if _count_featured_listings(user["id"], item["id"]) >= plan["featuredSlots"]:
            raise HTTPException(
                status_code=403,
                detail={"error": f"{plan['name']} plan allows {plan['featuredSlots']} featured slots."},
            )

    expires_at = (
        _future_sql_date(plan["listingDays"])
        if next_status == "active" and not item["expires_at"]
        else item["expires_at"]
    )
    next_distress = (
        item["is_distress"]
        if out["is_distress"] is None
        else (1 if plan["distressPinned"] and out["is_distress"] else 0)
    )

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
    auction_status = "active" if enabling_auction else item["auction_status"]
    video_url = item["video_url"] if out["video_url"] == "SKIP" else out["video_url"]
    shipping_fee = (
        item.get("shipping_fee_cents") or 0
        if out["shipping_fee_cents"] == "SKIP" else out["shipping_fee_cents"]
    )
    free_threshold = (
        item.get("free_shipping_threshold_cents") or 0
        if out["free_shipping_threshold_cents"] == "SKIP"
        else out["free_shipping_threshold_cents"]
    )
    pickup_available = (
        item.get("pickup_available", 1)
        if out["pickup_available"] == "SKIP"
        else (1 if out["pickup_available"] is not False else 0)
    )
    processing_days = (
        item.get("processing_days") or 2
        if out["processing_days"] == "SKIP" else out["processing_days"]
    )
    shipping_notes = (
        item.get("shipping_notes") or ""
        if out["shipping_notes"] == "SKIP" else out["shipping_notes"]
    )

    db.run(
        "UPDATE items SET title = ?, description = ?, price = ?, sale_price = ?, sale_ends_at = ?, "
        "category = ?, condition = ?, location_lat = ?, location_lng = ?, location_address = ?, "
        "quantity = ?, status = ?, boosted = ?, boost_expires_at = ?, updated_at = datetime('now'), "
        "is_auction = ?, starting_bid = ?, min_increment = ?, auction_ends_at = ?, auction_status = ?, "
        "currency = ?, video_url = ?, expires_at = ?, is_distress = ?, shipping_fee_cents = ?, "
        "free_shipping_threshold_cents = ?, pickup_available = ?, processing_days = ?, "
        "shipping_notes = ? WHERE id = ?",
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
            next_status,
            (1 if out["boosted"] is True else 0) if out["boosted"] is not None else item["boosted"],
            boost_expires,
            (1 if out["is_auction"] is True else 0) if out["is_auction"] is not None else item["is_auction"],
            starting_bid,
            min_increment,
            auction_ends,
            auction_status,
            out["currency"] if out["currency"] is not None else item["currency"],
            video_url,
            expires_at,
            next_distress,
            shipping_fee or 0,
            free_threshold or 0,
            pickup_available,
            processing_days or 2,
            shipping_notes or "",
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


@router.post("/{item_id}/renew")
def renew_item(item_id: str, user: dict = Depends(require_user)):
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})

    plan = _seller_plan(user["id"])
    if plan["maxListings"] != -1 and _count_published_listings(user["id"], item["id"]) >= plan["maxListings"]:
        raise HTTPException(status_code=403, detail={"error": _listing_limit_error(plan)})

    expires_at = _future_sql_date(plan["listingDays"])
    db.run(
        "UPDATE items SET status = 'active', expires_at = ?, expiry_warned_at = NULL, "
        "locked_at = NULL, lock_reason = NULL, updated_at = datetime('now') WHERE id = ?",
        (expires_at, item["id"]),
    )
    return {"success": True, "expires_at": expires_at}


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
        seller["badge"] = "Pro Seller" if seller["plan"] == "pro" else "Gold Seller"
        enriched.append(seller)

    return {"sellers": enriched}