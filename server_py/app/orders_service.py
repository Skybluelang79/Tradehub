import json
import uuid

from fastapi import HTTPException

from . import db
from .notifications import notify

SHIPMENT_STATUSES = {"pending", "shipped", "in_transit", "delivered", "cancelled"}
PAID_ORDER_STATUSES = {"processing", "partially_shipped", "shipped", "delivered", "completed"}


def _event(order_id, event_type, actor_id=None, data=None):
    db.run(
        "INSERT INTO order_events (id, order_id, type, actor_id, data) VALUES (?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), order_id, event_type, actor_id, json.dumps(data or {})),
    )


def _load_snapshot(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _address_snapshot(address_id, user_id):
    address = None
    if address_id:
        address = db.get(
            "SELECT * FROM addresses WHERE id = ? AND user_id = ?",
            (address_id, user_id),
        )
        if not address:
            raise HTTPException(status_code=400, detail={"error": "Shipping address not found"})
    else:
        address = db.get(
            "SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC LIMIT 1",
            (user_id,),
        )
    if not address:
        return None, {}
    snapshot = {
        "id": address["id"],
        "label": address.get("label") or "Home",
        "full_name": address.get("full_name") or "",
        "phone": address.get("phone") or "",
        "line1": address.get("line1") or "",
        "line2": address.get("line2") or "",
        "city": address.get("city") or "",
        "region": address.get("region") or "",
        "postal_code": address.get("postal_code") or "",
        "country": address.get("country") or "NG",
    }
    return address["id"], snapshot


def _tracking_url(value):
    url = str(value or "").strip()
    if url and not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(
            status_code=400,
            detail={"error": "Tracking URL must start with http:// or https://"},
        )
    return url


def _item_image(item_id):
    row = db.get(
        "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1",
        (item_id,),
    )
    return row["url"] if row else ""


def create_order(
    *,
    buyer_id,
    currency,
    lines,
    status="processing",
    payment_reference=None,
    payment_method="",
    shipping_cents=0,
    tax_cents=0,
    shipping_address_id=None,
    billing_address_id=None,
):
    """Create an order and its line items from settled or pending checkout lines."""
    if not lines:
        raise ValueError("An order needs at least one line")

    address_id, shipping_snapshot = _address_snapshot(shipping_address_id, buyer_id)
    billing_id, billing_snapshot = (
        _address_snapshot(billing_address_id, buyer_id)
        if billing_address_id
        else (address_id, shipping_snapshot)
    )

    subtotal_cents = sum(
        int(line.get("line_subtotal_cents", line.get("line_net_cents", 0))) for line in lines
    )
    discount_cents = sum(int(line.get("line_discount_cents", 0)) for line in lines)
    total_cents = (
        sum(int(line.get("line_net_cents", 0)) for line in lines)
        + int(shipping_cents or 0)
        + int(tax_cents or 0)
    )

    order_id = str(uuid.uuid4())
    db.run(
        """
        INSERT INTO orders (
          id, buyer_id, currency, subtotal_cents, shipping_cents, tax_cents,
          discount_cents, total_cents, status, shipping_address_id,
          billing_address_id, shipping_address_json, billing_address_json,
          payment_reference, payment_method
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            order_id, buyer_id, currency, subtotal_cents, int(shipping_cents or 0),
            int(tax_cents or 0), discount_cents, total_cents, status, address_id,
            billing_id, json.dumps(shipping_snapshot), json.dumps(billing_snapshot),
            payment_reference, payment_method or "",
        ),
    )

    item_status = "pending" if status == "awaiting_payment" else "processing"
    seller_titles = {}
    for line in lines:
        item = line["item"]
        quantity = max(1, int(line.get("quantity") or 1))
        line_subtotal = int(line.get("line_subtotal_cents", 0))
        db.run(
            """
            INSERT INTO order_items (
              id, order_id, item_id, seller_id, quantity, unit_price_cents,
              currency, item_title, item_image, status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()), order_id, item["id"], item["seller_id"], quantity,
                round(line_subtotal / quantity) if line_subtotal else 0,
                line.get("currency") or currency,
                item.get("title") or "",
                _item_image(item["id"]),
                item_status,
            ),
        )
        seller_titles.setdefault(item["seller_id"], []).append(item.get("title") or "your item")

    _event(
        order_id,
        "order_created",
        buyer_id,
        {
            "status": status,
            "itemCount": len(lines),
            "totalCents": total_cents,
            "paymentReference": payment_reference,
        },
    )

    for seller_id, titles in seller_titles.items():
        label = titles[0] if len(titles) == 1 else f"{len(titles)} items"
        notify(
            seller_id,
            "sale",
            "New order received",
            f"You have a new order for {label}.",
            json.dumps({"orderId": order_id}),
        )

    return order_id


def _order_for_user(order_id, user):
    order = db.get("SELECT * FROM orders WHERE id = ?", (order_id,))
    if not order:
        raise HTTPException(status_code=404, detail={"error": "Order not found"})
    seller_ids = [
        row["seller_id"]
        for row in db.all(
            "SELECT DISTINCT seller_id FROM order_items WHERE order_id = ?", (order_id,)
        )
    ]
    is_buyer = order["buyer_id"] == user["id"]
    is_seller = user["id"] in seller_ids
    if not is_buyer and not is_seller and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    return order, seller_ids, is_buyer, is_seller


def list_orders(user, role="all"):
    where = "o.buyer_id = ?"
    params = [user["id"]]
    if role == "seller":
        where = "EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.seller_id = ?)"
    elif role == "buyer":
        where = "o.buyer_id = ?"
    elif role == "all":
        where = (
            "o.buyer_id = ? OR EXISTS "
            "(SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.seller_id = ?)"
        )
        params = [user["id"], user["id"]]

    rows = db.all(
        f"""
        SELECT o.*,
          (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count,
          (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS unit_count,
          (SELECT COUNT(DISTINCT oi.seller_id) FROM order_items oi WHERE oi.order_id = o.id) AS seller_count,
          (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id) AS shipment_count,
          (SELECT COUNT(*) FROM shipments s WHERE s.order_id = o.id AND s.status = 'delivered') AS delivered_shipment_count,
          (SELECT COUNT(*) FROM returns r WHERE r.order_id = o.id AND r.status NOT IN ('cancelled', 'declined')) AS return_count,
          (SELECT COALESCE(NULLIF(oi.item_title, ''), i.title)
             FROM order_items oi LEFT JOIN items i ON i.id = oi.item_id
             WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS primary_title,
          (SELECT COALESCE(NULLIF(oi.item_image, ''), (
              SELECT im.url FROM item_images im WHERE im.item_id = oi.item_id ORDER BY im.sort_order LIMIT 1
           ))
             FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.created_at LIMIT 1) AS primary_image
        FROM orders o
        WHERE {where}
        ORDER BY o.created_at DESC
        """,
        tuple(params),
    )
    for row in rows:
        row["shipping_address"] = _load_snapshot(row.get("shipping_address_json"))
    return rows


def order_detail(order_id, user):
    order, seller_ids, is_buyer, is_seller = _order_for_user(order_id, user)
    items = db.all(
        """
        SELECT oi.*,
          COALESCE(NULLIF(oi.item_title, ''), i.title, 'Item') AS title,
          COALESCE(NULLIF(oi.item_image, ''), (
            SELECT im.url FROM item_images im WHERE im.item_id = oi.item_id ORDER BY im.sort_order LIMIT 1
          )) AS image,
          u.name AS seller_name,
          u.store_slug AS seller_store_slug
        FROM order_items oi
        LEFT JOIN items i ON i.id = oi.item_id
        LEFT JOIN users u ON u.id = oi.seller_id
        WHERE oi.order_id = ?
        ORDER BY oi.created_at
        """,
        (order_id,),
    )
    shipments = db.all(
        "SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at DESC",
        (order_id,),
    )
    events = db.all(
        "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at DESC",
        (order_id,),
    )
    for event in events:
        event["data"] = _load_snapshot(event.get("data"))

    transactions = db.all(
        "SELECT id, item_id, item_title, amount, currency, status, method, created_at "
        "FROM transactions WHERE order_id = ? ORDER BY created_at",
        (order_id,),
    )
    buyer = db.get(
        "SELECT id, name, email, avatar FROM users WHERE id = ?", (order["buyer_id"],)
    )
    snapshot = _load_snapshot(order.get("shipping_address_json"))
    if not snapshot and order.get("shipping_address_id"):
        row = db.get("SELECT * FROM addresses WHERE id = ?", (order["shipping_address_id"],))
        if row:
            snapshot = {
                "id": row["id"], "label": row.get("label") or "Home",
                "full_name": row.get("full_name") or "", "phone": row.get("phone") or "",
                "line1": row.get("line1") or "", "line2": row.get("line2") or "",
                "city": row.get("city") or "", "region": row.get("region") or "",
                "postal_code": row.get("postal_code") or "", "country": row.get("country") or "NG",
            }
    order.update(
        {
            "shipping_address": snapshot,
            "items": items,
            "shipments": shipments,
            "events": events,
            "transactions": transactions,
            "buyer": buyer,
            "seller_ids": seller_ids,
            "viewer_role": "buyer" if is_buyer else ("seller" if is_seller else "admin"),
        }
    )
    return order


def mark_order_paid(reference=None, order_id=None):
    order = None
    if order_id:
        order = db.get("SELECT * FROM orders WHERE id = ?", (order_id,))
    if not order and reference:
        order = db.get(
            "SELECT * FROM orders WHERE payment_reference = ? "
            "ORDER BY created_at DESC LIMIT 1",
            (reference,),
        )
    if not order or order["status"] in ("cancelled", "refunded"):
        return None
    changed = order["status"] in ("awaiting_payment", "pending")
    if changed:
        db.run(
            "UPDATE orders SET status = 'processing', updated_at = datetime('now') WHERE id = ?",
            (order["id"],),
        )
        db.run(
            "UPDATE order_items SET status = 'processing' WHERE order_id = ? AND status = 'pending'",
            (order["id"],),
        )
        _event(
            order["id"],
            "payment_confirmed",
            order["buyer_id"],
            {"paymentReference": reference or order.get("payment_reference")},
        )
    return order["id"]


def sync_order_payment_state(order_id):
    if not order_id:
        return
    order = db.get("SELECT * FROM orders WHERE id = ?", (order_id,))
    if not order:
        return
    txns = db.all("SELECT status FROM transactions WHERE order_id = ?", (order_id,))
    if not txns:
        return
    statuses = {row["status"] for row in txns}
    if statuses <= {"refunded"}:
        status = "refunded"
    elif statuses <= {"completed", "refunded"}:
        status = "completed"
    elif "refunded" in statuses:
        status = "partially_refunded"
    elif statuses <= {"pending", "completed"}:
        status = "processing" if order["status"] in ("pending", "awaiting_payment") else order["status"]
    else:
        return
    if status != order["status"]:
        db.run(
            "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, order_id),
        )
        _event(order_id, "order_status_updated", None, {"status": status})


def _sync_shipping_status(order_id):
    order = db.get("SELECT * FROM orders WHERE id = ?", (order_id,))
    if not order or order["status"] in (
        "awaiting_payment", "pending", "cancelled", "refunded",
        "partially_refunded", "completed",
    ):
        return order["status"] if order else None
    rows = db.all(
        "SELECT status FROM order_items WHERE order_id = ? "
        "AND status NOT IN ('cancelled', 'refunded')",
        (order_id,),
    )
    if not rows:
        return order["status"]
    statuses = {row["status"] for row in rows}
    if statuses <= {"delivered"}:
        status = "delivered"
    elif statuses <= {"shipped", "delivered"}:
        status = "shipped"
    elif statuses & {"shipped", "delivered"}:
        status = "partially_shipped"
    else:
        status = "processing"
    if status != order["status"]:
        db.run(
            "UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, order_id),
        )
        _event(order_id, "order_status_updated", None, {"status": status})
    return status


def create_shipment(order_id, user, body):
    order, seller_ids, _is_buyer, _is_seller = _order_for_user(order_id, user)
    if not user.get("isAdmin") and user["id"] not in seller_ids:
        raise HTTPException(status_code=403, detail={"error": "Only the seller can ship this order"})
    if order["status"] in ("awaiting_payment", "pending", "cancelled", "refunded"):
        raise HTTPException(status_code=400, detail={"error": "This order is not ready to ship"})

    seller_id = body.get("sellerId") if user.get("isAdmin") else user["id"]
    if seller_id not in seller_ids:
        raise HTTPException(status_code=400, detail={"error": "Seller has no items in this order"})
    items = db.all(
        "SELECT * FROM order_items WHERE order_id = ? AND seller_id = ? "
        "AND status NOT IN ('cancelled', 'refunded')",
        (order_id, seller_id),
    )
    if not items:
        raise HTTPException(status_code=400, detail={"error": "No items available to ship"})

    carrier = str(body.get("carrier") or "").strip()
    if not carrier:
        raise HTTPException(status_code=400, detail={"error": "Carrier is required"})
    tracking_number = str(body.get("trackingNumber") or "").strip()
    tracking_url = _tracking_url(body.get("trackingUrl"))
    service = str(body.get("service") or "").strip()
    shipment = db.get(
        "SELECT * FROM shipments WHERE order_id = ? AND seller_id = ? "
        "ORDER BY created_at DESC LIMIT 1",
        (order_id, seller_id),
    )
    if shipment:
        db.run(
            """
            UPDATE shipments
            SET carrier = ?, service = ?, tracking_number = ?, tracking_url = ?,
                status = 'shipped', shipped_at = COALESCE(shipped_at, datetime('now')),
                updated_at = datetime('now')
            WHERE id = ?
            """,
            (carrier, service, tracking_number, tracking_url, shipment["id"]),
        )
        shipment_id = shipment["id"]
        event_type = "shipment_updated"
    else:
        shipment_id = str(uuid.uuid4())
        db.run(
            """
            INSERT INTO shipments (
              id, order_id, seller_id, carrier, service, tracking_number,
              tracking_url, status, shipped_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'shipped', datetime('now'))
            """,
            (shipment_id, order_id, seller_id, carrier, service, tracking_number, tracking_url),
        )
        event_type = "shipment_created"

    db.run(
        "UPDATE order_items SET status = 'shipped' WHERE order_id = ? AND seller_id = ? "
        "AND status NOT IN ('cancelled', 'refunded', 'delivered')",
        (order_id, seller_id),
    )
    _sync_shipping_status(order_id)
    _event(
        order_id,
        event_type,
        user["id"],
        {
            "shipmentId": shipment_id,
            "carrier": carrier,
            "trackingNumber": tracking_number,
            "trackingUrl": tracking_url,
        },
    )
    notify(
        order["buyer_id"],
        "order",
        "Your order has shipped",
        f"{carrier} is now delivering your order."
        + (f" Tracking: {tracking_number}." if tracking_number else ""),
        json.dumps({"orderId": order_id, "shipmentId": shipment_id}),
    )
    return order_detail(order_id, user)


def update_shipment(order_id, shipment_id, user, body):
    order, seller_ids, _is_buyer, _is_seller = _order_for_user(order_id, user)
    shipment = db.get(
        "SELECT * FROM shipments WHERE id = ? AND order_id = ?", (shipment_id, order_id)
    )
    if not shipment:
        raise HTTPException(status_code=404, detail={"error": "Shipment not found"})
    if not user.get("isAdmin") and shipment["seller_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Only the seller can update this shipment"})

    status = body.get("status")
    if status is not None and status not in SHIPMENT_STATUSES:
        raise HTTPException(status_code=400, detail={"error": "Invalid shipment status"})
    assignments = []
    params = []
    for field, column in (
        ("carrier", "carrier"),
        ("service", "service"),
        ("trackingNumber", "tracking_number"),
        ("trackingUrl", "tracking_url"),
    ):
        if field in body:
            assignments.append(f"{column} = ?")
            value = _tracking_url(body.get(field)) if field == "trackingUrl" else str(body.get(field) or "").strip()
            params.append(value)
    if status:
        assignments.append("status = ?")
        params.append(status)
        if status == "shipped":
            assignments.append("shipped_at = COALESCE(shipped_at, datetime('now'))")
        if status == "delivered":
            assignments.append("shipped_at = COALESCE(shipped_at, datetime('now'))")
            assignments.append("delivered_at = COALESCE(delivered_at, datetime('now'))")
    assignments.append("updated_at = datetime('now')")
    params.append(shipment_id)
    db.run(f"UPDATE shipments SET {', '.join(assignments)} WHERE id = ?", tuple(params))

    if status in ("shipped", "in_transit", "delivered"):
        item_status = "delivered" if status == "delivered" else "shipped"
        db.run(
            "UPDATE order_items SET status = ? WHERE order_id = ? AND seller_id = ? "
            "AND status NOT IN ('cancelled', 'refunded', 'delivered')",
            (item_status, order_id, shipment["seller_id"]),
        )
    _sync_shipping_status(order_id)
    _event(
        order_id,
        "shipment_updated",
        user["id"],
        {"shipmentId": shipment_id, "status": status or shipment["status"]},
    )
    if status:
        notify(
            order["buyer_id"],
            "order",
            "Shipment update",
            f"Your shipment is now {status.replace('_', ' ')}.",
            json.dumps({"orderId": order_id, "shipmentId": shipment_id}),
        )
    return order_detail(order_id, user)


def confirm_delivery(order_id, user):
    order, _seller_ids, is_buyer, _is_seller = _order_for_user(order_id, user)
    if not is_buyer and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Only the buyer can confirm delivery"})
    if order["status"] in ("awaiting_payment", "pending", "cancelled", "refunded"):
        raise HTTPException(status_code=400, detail={"error": "This order cannot be confirmed yet"})
    if order["status"] == "completed":
        return order_detail(order_id, user)

    db.run(
        "UPDATE shipments SET status = 'delivered', "
        "shipped_at = COALESCE(shipped_at, datetime('now')), "
        "delivered_at = COALESCE(delivered_at, datetime('now')), "
        "updated_at = datetime('now') WHERE order_id = ?",
        (order_id,),
    )
    db.run(
        "UPDATE order_items SET status = 'delivered' "
        "WHERE order_id = ? AND status NOT IN ('cancelled', 'refunded')",
        (order_id,),
    )
    _event(order_id, "delivery_confirmed", user["id"], {"confirmedBy": user["id"]})

    # Confirming delivery is also the buyer's escrow release action.
    from .routers import payments

    txns = db.all("SELECT * FROM transactions WHERE order_id = ?", (order_id,))
    for txn in txns:
        if txn["status"] == "pending":
            payments.finalize_completed(txn)
    sync_order_payment_state(order_id)
    _sync_shipping_status(order_id)

    notify(
        order["buyer_id"],
        "order",
        "Order delivered",
        "You confirmed delivery. Escrow funds have been released to the seller.",
        json.dumps({"orderId": order_id}),
    )
    for seller_id in {
        row["seller_id"] for row in db.all(
            "SELECT DISTINCT seller_id FROM order_items WHERE order_id = ?", (order_id,)
        )
    }:
        notify(
            seller_id,
            "sale",
            "Order completed",
            "The buyer confirmed delivery and the funds are now in your wallet.",
            json.dumps({"orderId": order_id}),
        )
    return order_detail(order_id, user)
