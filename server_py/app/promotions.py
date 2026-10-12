from fastapi import HTTPException

from . import db


def validate_and_apply_promo(code, amount):
    if not code or not str(code).strip():
        return {"discount": 0.0, "promo": None}

    promo = db.get(
        """
        SELECT * FROM promotions
        WHERE code = ? AND active = 1
        AND (max_uses = 0 OR used_count < max_uses)
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        """,
        (str(code).strip().upper(),),
    )

    if not promo:
        raise HTTPException(status_code=400, detail={"error": "Invalid or expired promotion code"})

    if promo.get("min_purchase") and amount < promo["min_purchase"]:
        raise HTTPException(
            status_code=400,
            detail={"error": f"Minimum purchase of \u20a6{promo['min_purchase']} required"},
        )

    discount = 0.0
    if promo.get("discount_type") == "percentage":
        discount = amount * (promo["discount_value"] / 100)
        discount = min(discount, amount)
    else:
        discount = min(promo["discount_value"], amount)
    discount = round(discount * 100) / 100

    return {"discount": discount, "promo": promo}


def consume_promo(code):
    if not code:
        return
    promo = db.get("SELECT * FROM promotions WHERE code = ?", (str(code).strip().upper(),))
    if not promo:
        return
    db.run("UPDATE promotions SET used_count = used_count + 1 WHERE id = ?", (promo["id"],))
    if promo["max_uses"] > 0 and promo["used_count"] + 1 >= promo["max_uses"]:
        db.run("UPDATE promotions SET active = 0 WHERE id = ?", (promo["id"],))


def release_promo(code):
    if not code:
        return
    promo = db.get("SELECT * FROM promotions WHERE code = ?", (str(code).strip().upper(),))
    if not promo:
        return
    used = max(0, (promo["used_count"] or 0) - 1)
    expired = promo.get("expires_at") is not None and promo["expires_at"] <= _now_iso()
    can_enable = promo["max_uses"] > 0 and used < promo["max_uses"] and not expired
    db.run(
        "UPDATE promotions SET used_count = ?, active = ? WHERE id = ?",
        (used, 1 if can_enable else promo["active"], promo["id"]),
    )


def _now_iso():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).astimezone().isoformat()