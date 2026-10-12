import json
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user

router = APIRouter()


@router.get("")
def list_templates(user: dict = Depends(require_user)):
    templates = db.all(
        "SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC",
        (user["id"],),
    )
    return {"templates": templates}


@router.post("", status_code=201)
def create_template(body: dict = Body(default={}), user: dict = Depends(require_user)):
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail={"error": "Template name required"})

    template_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO templates (id, user_id, name, title, description, price, category, condition, "
        "quantity, sale_price, variants) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            template_id,
            user["id"],
            name,
            body.get("title") or "",
            body.get("description") or "",
            body.get("price") or "",
            body.get("category") or "",
            body.get("condition") or "",
            body.get("quantity") or 1,
            body.get("sale_price") or "",
            json.dumps(body.get("variants") or []),
        ),
    )

    template = db.get("SELECT * FROM templates WHERE id = ?", (template_id,))
    return {"template": template}


@router.delete("/{template_id}")
def delete_template(template_id: str, user: dict = Depends(require_user)):
    db.run(
        "DELETE FROM templates WHERE id = ? AND user_id = ?",
        (template_id, user["id"]),
    )
    return {"success": True}
