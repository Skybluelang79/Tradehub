import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_admin

logger = logging.getLogger("tradehub")

router = APIRouter()


def _create_promotion_errors(body):
    details = []
    code = body.get("code")
    if not isinstance(code, str) or len(code) < 3 or len(code) > 20:
        details.append("code: must be a string between 3 and 20 characters")
    if body.get("discount_type") not in ("percentage", "fixed"):
        details.append("discount_type: must be 'percentage' or 'fixed'")
    discount_value = body.get("discount_value")
    if not isinstance(discount_value, (int, float)) or isinstance(discount_value, bool) or discount_value <= 0:
        details.append("discount_value: must be a positive number")
    max_uses = body.get("max_uses")
    if max_uses is not None and (
        not isinstance(max_uses, int) or isinstance(max_uses, bool) or max_uses <= 0
    ):
        details.append("max_uses: must be a positive integer")
    expires_at = body.get("expires_at")
    if expires_at is not None and not isinstance(expires_at, str):
        details.append("expires_at: must be a string")
    min_purchase = body.get("min_purchase")
    if min_purchase is not None and (
        not isinstance(min_purchase, (int, float)) or isinstance(min_purchase, bool) or min_purchase <= 0
    ):
        details.append("min_purchase: must be a positive number")
    return details


@router.post("", status_code=201)
def create_promotion(user: dict = Depends(require_admin), body: dict = Body(...)):
    errors = _create_promotion_errors(body)
    if errors:
        raise HTTPException(status_code=400, detail={"error": "Validation failed", "details": errors})

    code = body["code"].upper()
    existing = db.get("SELECT id FROM promotions WHERE code = ?", (code,))
    if existing:
        raise HTTPException(status_code=409, detail={"error": "Promotion code already exists"})

    promo_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO promotions (id, code, discount_type, discount_value, max_uses, expires_at, min_purchase) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            promo_id,
            code,
            body["discount_type"],
            body["discount_value"],
            body.get("max_uses") or 0,
            body.get("expires_at") or None,
            body.get("min_purchase") or None,
        ),
    )
    return {"promotion": db.get("SELECT * FROM promotions WHERE id = ?", (promo_id,))}


@router.get("")
def list_promotions(user: dict = Depends(require_admin)):
    promotions = db.all("SELECT * FROM promotions ORDER BY created_at DESC")
    return {"promotions": promotions}


@router.post("/validate")
def validate_promotion(body: dict = Body(...)):
    code = body.get("code")
    amount = body.get("amount") or 0

    if not code:
        raise HTTPException(status_code=400, detail={"error": "Code required"})

    promo = db.get(
        """
        SELECT * FROM promotions
        WHERE code = ? AND active = 1
        AND (max_uses = 0 OR used_count < max_uses)
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        """,
        (str(code).upper(),),
    )
    if not promo:
        raise HTTPException(status_code=400, detail={"error": "Invalid or expired promotion code"})

    if promo.get("min_purchase") and amount and amount < promo["min_purchase"]:
        raise HTTPException(
            status_code=400,
            detail={
                "error": f"Minimum purchase of \u20a6{promo['min_purchase']} required",
                "min_purchase": promo["min_purchase"],
            },
        )

    discount = 0.0
    if promo["discount_type"] == "percentage":
        discount = (amount or 0) * (promo["discount_value"] / 100)
        discount = min(discount, amount or 0)
    else:
        discount = promo["discount_value"]
        if amount:
            discount = min(discount, amount)

    return {"valid": True, "promotion": promo, "discount": round(discount * 100) / 100}


@router.put("/{promotion_id}")
def update_promotion(promotion_id: str, user: dict = Depends(require_admin), body: dict = Body(...)):
    existing = db.get("SELECT * FROM promotions WHERE id = ?", (promotion_id,))
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Promotion not found"})

    code = body.get("code")
    discount_type = body.get("discount_type")
    discount_value = body.get("discount_value")
    max_uses = body.get("max_uses")
    active = body.get("active")

    db.run(
        "UPDATE promotions SET code = ?, discount_type = ?, discount_value = ?, max_uses = ?, "
        "expires_at = ?, min_purchase = ?, active = ? WHERE id = ?",
        (
            str(code).upper() if code is not None else existing["code"],
            discount_type if discount_type is not None else existing["discount_type"],
            discount_value if discount_value is not None else existing["discount_value"],
            max_uses if max_uses is not None else existing["max_uses"],
            body["expires_at"] if "expires_at" in body else existing["expires_at"],
            body["min_purchase"] if "min_purchase" in body else existing["min_purchase"],
            (1 if active else 0) if active is not None else existing["active"],
            promotion_id,
        ),
    )
    return {"promotion": db.get("SELECT * FROM promotions WHERE id = ?", (promotion_id,))}


@router.delete("/{promotion_id}")
def delete_promotion(promotion_id: str, user: dict = Depends(require_admin)):
    existing = db.get("SELECT * FROM promotions WHERE id = ?", (promotion_id,))
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Promotion not found"})
    db.run("DELETE FROM promotions WHERE id = ?", (promotion_id,))
    return {"success": True}
