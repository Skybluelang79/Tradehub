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


@router.get("")
def list_searches(user: dict = Depends(require_user)):
    searches = db.all(
        "SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],),
    )
    return {"searches": searches}


@router.post("")
def create_search(body: dict = Body(...), user: dict = Depends(require_user)):
    name = body.get("name")
    query = body.get("query", "")
    category = body.get("category", "")
    min_price = body.get("min_price")
    max_price = body.get("max_price")

    clean_name = str(name or query or "Untitled search").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail={"error": "Search name is required"})

    count = db.get("SELECT COUNT(*) c FROM saved_searches WHERE user_id = ?", (user["id"],))
    if count["c"] >= 50:
        raise HTTPException(status_code=400, detail={"error": "Maximum of 50 saved searches reached"})

    search_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO saved_searches (id, user_id, name, query, category, min_price, max_price) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            search_id,
            user["id"],
            clean_name[:120],
            str(query)[:120],
            str(category)[:50],
            _clean_price(min_price),
            _clean_price(max_price),
        ),
    )
    return {"search": db.get("SELECT * FROM saved_searches WHERE id = ?", (search_id,))}


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

    db.run(
        "UPDATE saved_searches SET name = ?, query = ?, category = ?, min_price = ?, max_price = ? WHERE id = ?",
        (
            str(name or query or "Untitled search").strip()[:120],
            str(query)[:120],
            str(category)[:50],
            _clean_price(min_price),
            _clean_price(max_price),
            existing["id"],
        ),
    )
    return {"search": db.get("SELECT * FROM saved_searches WHERE id = ?", (existing["id"],))}


@router.delete("/{search_id}")
def delete_search(search_id: str, user: dict = Depends(require_user)):
    db.run("DELETE FROM saved_searches WHERE id = ? AND user_id = ?", (search_id, user["id"]))
    return {"success": True}