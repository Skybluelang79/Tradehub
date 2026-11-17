import json
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user

logger = logging.getLogger("tradehub")

router = APIRouter()


def _clean_price(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clean_filters(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = None
    if not isinstance(value, dict):
        return {}

    out = {}
    condition = str(value.get("condition") or "").strip().lower()
    if condition:
        out["condition"] = condition[:30]
    brand = str(value.get("brand") or "").strip()
    if brand:
        out["brand"] = brand[:60]
    size = str(value.get("size") or "").strip()
    if size:
        out["size"] = size[:60]

    min_rating = _clean_price(value.get("min_rating"))
    if min_rating is not None and 0 <= min_rating <= 5:
        out["min_rating"] = min_rating

    attributes = value.get("attributes")
    if isinstance(attributes, dict):
        cleaned = {}
        for name, attr_value in list(attributes.items())[:20]:
            clean_name = str(name or "").strip()
            clean_value = str(attr_value or "").strip()
            if clean_name and clean_value:
                cleaned[clean_name[:60]] = clean_value[:200]
        if cleaned:
            out["attributes"] = cleaned
    return out


def _search_row(row):
    row = dict(row)
    raw = row.get("filters")
    if raw:
        try:
            row["filters"] = json.loads(raw)
        except Exception:
            row["filters"] = {}
    else:
        row["filters"] = {}
    return row


@router.get("")
def list_searches(user: dict = Depends(require_user)):
    searches = db.all(
        "SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],),
    )
    return {"searches": [_search_row(search) for search in searches]}


@router.post("")
def create_search(body: dict = Body(...), user: dict = Depends(require_user)):
    name = body.get("name")
    query = body.get("query", "")
    category = body.get("category", "")
    min_price = body.get("min_price")
    max_price = body.get("max_price")
    filters = _clean_filters(body.get("filters"))

    clean_name = str(name or query or "Untitled search").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail={"error": "Search name is required"})

    count = db.get("SELECT COUNT(*) c FROM saved_searches WHERE user_id = ?", (user["id"],))
    if count["c"] >= 50:
        raise HTTPException(status_code=400, detail={"error": "Maximum of 50 saved searches reached"})

    search_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO saved_searches (id, user_id, name, query, category, min_price, max_price, filters) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (
            search_id,
            user["id"],
            clean_name[:120],
            str(query)[:120],
            str(category)[:50],
            _clean_price(min_price),
            _clean_price(max_price),
            json.dumps(filters) if filters else None,
        ),
    )
    row = db.get("SELECT * FROM saved_searches WHERE id = ?", (search_id,))
    return {"search": _search_row(row)}


@router.put("/{search_id}")
def update_search(search_id: str, body: dict = Body(...), user: dict = Depends(require_user)):
    existing = db.get(
        "SELECT id FROM saved_searches WHERE id = ? AND user_id = ?", (search_id, user["id"])
    )
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Saved search not found"})

    name = body.get("name")
    query = body.get("query", "")
    category = body.get("category", "")
    min_price = body.get("min_price")
    max_price = body.get("max_price")
    filters = _clean_filters(body.get("filters"))

    db.run(
        "UPDATE saved_searches SET name = ?, query = ?, category = ?, min_price = ?, max_price = ?, filters = ? WHERE id = ?",
        (
            str(name or query or "Untitled search").strip()[:120],
            str(query)[:120],
            str(category)[:50],
            _clean_price(min_price),
            _clean_price(max_price),
            json.dumps(filters) if filters else None,
            existing["id"],
        ),
    )
    row = db.get("SELECT * FROM saved_searches WHERE id = ?", (existing["id"],))
    return {"search": _search_row(row)}


@router.delete("/{search_id}")
def delete_search(search_id: str, user: dict = Depends(require_user)):
    db.run("DELETE FROM saved_searches WHERE id = ? AND user_id = ?", (search_id, user["id"]))
    return {"success": True}