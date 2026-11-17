from . import db

FULFILLMENT_METHODS = ("shipping", "pickup")


def normalize_fulfillment_method(value):
    raw = str(value or "shipping").strip().lower().replace("-", "_")
    if raw in ("pickup", "local_pickup", "collect"):
        return "pickup"
    return "shipping"


def platform_setting(key, default=""):
    row = db.get("SELECT value FROM platform_settings WHERE key = ?", (key,))
    if not row or row.get("value") is None:
        return default
    return row["value"]


def tax_settings():
    try:
        percent = float(platform_setting("tax_percent", "0") or 0)
    except (TypeError, ValueError):
        percent = 0.0
    percent = min(max(percent, 0.0), 30.0)
    inclusive = str(platform_setting("tax_inclusive", "0")).strip().lower() in (
        "1", "true", "yes", "on"
    )
    return {
        "percent": percent,
        "rate": percent / 100,
        "inclusive": inclusive,
        "label": str(platform_setting("tax_label", "") or "Tax").strip() or "Tax",
    }


def calculate_tax(taxable_cents):
    settings = tax_settings()
    taxable_cents = max(0, int(round(taxable_cents or 0)))
    rate = settings["rate"]
    if taxable_cents <= 0 or rate <= 0:
        return 0, [], settings
    if settings["inclusive"]:
        tax_cents = int(round(taxable_cents * rate / (1 + rate)))
    else:
        tax_cents = int(round(taxable_cents * rate))
    breakdown = []
    if tax_cents > 0:
        breakdown.append({
            "label": settings["label"],
            "rate": settings["percent"],
            "taxableCents": taxable_cents,
            "amountCents": tax_cents,
        })
    return tax_cents, breakdown, settings


def _item_seller(item):
    return item.get("seller_id") or item.get("sellerId") or ""


def _item_shipping_cents(item):
    try:
        return max(0, int(round(item.get("shipping_fee_cents") or 0)))
    except (TypeError, ValueError):
        return 0


def _item_free_threshold(item):
    try:
        return max(0, int(round(item.get("free_shipping_threshold_cents") or 0)))
    except (TypeError, ValueError):
        return 0


def item_allows_pickup(item):
    value = item.get("pickup_available")
    if value is None:
        value = item.get("pickupAvailable")
    if value is None:
        return True
    return bool(value)


def calculate_shipping(lines, fulfillment_method="shipping"):
    method = normalize_fulfillment_method(fulfillment_method)
    if method == "pickup":
        return 0, []
    sellers = {}
    for line in lines:
        item = line.get("item") or {}
        seller_id = _item_seller(item)
        subtotal = int(line.get("line_net_cents") or line.get("line_subtotal_cents") or 0)
        entry = sellers.setdefault(seller_id, {
            "sellerId": seller_id,
            "merchandiseCents": 0,
            "shippingCents": 0,
            "freeThresholdCents": 0,
            "title": item.get("title") or "Item",
        })
        entry["merchandiseCents"] += max(0, subtotal)
        entry["shippingCents"] = max(entry["shippingCents"], _item_shipping_cents(item))
        entry["freeThresholdCents"] = max(entry["freeThresholdCents"], _item_free_threshold(item))
    total = 0
    breakdown = []
    for entry in sellers.values():
        fee = entry["shippingCents"]
        free = fee == 0 or (
            entry["freeThresholdCents"] > 0
            and entry["merchandiseCents"] >= entry["freeThresholdCents"]
        )
        amount = 0 if free else fee
        total += amount
        breakdown.append({
            "sellerId": entry["sellerId"],
            "amountCents": amount,
            "label": "Free shipping" if free else f"Shipping - {entry['title']}",
        })
    return total, breakdown


def quote_totals(lines, fulfillment_method="shipping"):
    merchandise_cents = sum(
        int(line.get("line_net_cents") or line.get("line_subtotal_cents") or 0)
        for line in lines
    )
    shipping_cents, shipping_breakdown = calculate_shipping(lines, fulfillment_method)
    tax_cents, tax_breakdown, settings = calculate_tax(merchandise_cents)
    return {
        "merchandiseCents": merchandise_cents,
        "shippingCents": shipping_cents,
        "taxCents": tax_cents,
        "totalCents": merchandise_cents + shipping_cents + tax_cents,
        "shippingBreakdown": shipping_breakdown,
        "taxBreakdown": tax_breakdown,
        "taxLabel": settings["label"],
        "taxRate": settings["percent"],
        "fulfillmentMethod": normalize_fulfillment_method(fulfillment_method),
    }


def validate_fulfillment(items, fulfillment_method):
    method = normalize_fulfillment_method(fulfillment_method)
    if method == "pickup":
        blocked = [item.get("title") or "An item" for item in items if not item_allows_pickup(item)]
        if blocked:
            return method, f"Pickup is not available for {blocked[0]}"
    return method, None


def invoice_number(order_id):
    compact = "".join(ch for ch in str(order_id or "").upper() if ch.isalnum())
    return f"INV-{compact[:10] or 'ORDER'}"
