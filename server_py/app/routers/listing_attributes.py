import json
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import optional_user, require_user

logger = logging.getLogger("tradehub")

router = APIRouter()

MAX_ATTRIBUTES = 40


def _load_item(item_id):
    row = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not row:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    return row


def _require_owner(item, user):
    if not user.get("isAdmin") and item["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})


def _attributes_for(item_id):
    rows = db.all(
        "SELECT name, value FROM listing_attributes WHERE item_id = ? ORDER BY name",
        (item_id,),
    )
    return {row["name"]: row["value"] for row in rows}


def _clean_attributes(body):
    raw = body.get("attributes") if isinstance(body, dict) else body
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail={"error": "attributes must be an array"})
    if len(raw) > MAX_ATTRIBUTES:
        raise HTTPException(status_code=400, detail={"error": f"At most {MAX_ATTRIBUTES} attributes are allowed"})

    out = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail={"error": "Each attribute must be an object"})
        name = str(entry.get("name") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not name or not value:
            raise HTTPException(status_code=400, detail={"error": "Attribute name and value are required"})
        if len(name) > 60 or len(value) > 200:
            raise HTTPException(status_code=400, detail={"error": "Attribute name or value is too long"})
        key = name.lower()
        if key in seen:
            raise HTTPException(status_code=400, detail={"error": f"Duplicate attribute: {name}"})
        seen.add(key)
        out.append((name, value))
    return out


@router.get("/{item_id}/attributes")
def get_attributes(item_id: str):
    _load_item(item_id)
    return {"attributes": _attributes_for(item_id)}


@router.post("/{item_id}/attributes", status_code=201)
def save_attributes(item_id: str, body: dict = Body(...), user: dict = Depends(require_user)):
    item = _load_item(item_id)
    _require_owner(item, user)
    attributes = _clean_attributes(body)

    db.run("DELETE FROM listing_attributes WHERE item_id = ?", (item_id,))
    for name, value in attributes:
        db.run(
            "INSERT INTO listing_attributes (id, item_id, name, value) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), item_id, name, value),
        )
    return {"attributes": _attributes_for(item_id)}


@router.delete("/{item_id}/attributes/{name}")
def delete_attribute(item_id: str, name: str, user: dict = Depends(require_user)):
    item = _load_item(item_id)
    _require_owner(item, user)
    db.run(
        "DELETE FROM listing_attributes WHERE item_id = ? AND LOWER(name) = LOWER(?)",
        (item_id, name),
    )
    return {"attributes": _attributes_for(item_id)}


@router.get("/{item_id}/comps")
def listing_comps(item_id: str, user: dict | None = Depends(optional_user)):
    item = _load_item(item_id)
    source_attrs = _attributes_for(item_id)
    source_price = float(item.get("sale_price") or item["price"] or 0)

    rows = db.all(
        """
        SELECT i.*, (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) AS image
        FROM items i
        WHERE i.status = 'active' AND i.id != ? AND LOWER(i.category) = LOWER(?)
        ORDER BY ABS(i.price - ?) ASC LIMIT 100
        """,
        (item_id, item["category"], source_price),
    )

    comps = []
    for row in rows:
        attrs = _attributes_for(row["id"])
        matched = [name for name, value in source_attrs.items() if attrs.get(name) == value]
        price = float(row.get("sale_price") or row["price"] or 0)
        if source_attrs and not matched:
            continue
        comps.append(
            {
                "id": row["id"],
                "title": row["title"],
                "price": price,
                "image": row["image"] or "",
                "condition": row["condition"],
                "distance": row.get("distance"),
                "matchedAttributes": matched,
                "matchScore": len(matched),
                "priceDifference": round(price - source_price, 2),
            }
        )

    comps.sort(key=lambda c: (-c["matchScore"], abs(c["priceDifference"])))
    comps = comps[:8]
    prices = [c["price"] for c in comps if c["price"] > 0]
    average = round(sum(prices) / len(prices), 2) if prices else source_price
    return {"comps": comps, "averagePrice": average, "suggestedPrice": average}
