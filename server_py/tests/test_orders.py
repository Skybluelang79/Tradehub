import uuid

from fastapi.testclient import TestClient

from app import db
from app.main import app

client = TestClient(app)


def signup(name):
    res = client.post(
        "/api/auth/signup",
        json={
            "name": name,
            "email": f"{name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}@test.dev",
            "password": "secret123",
            "username": f"{name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:6]}",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def make_item(token, price=5000):
    res = client.post(
        "/api/items",
        json={
            "title": f"Order item {uuid.uuid4().hex[:6]}",
            "description": "order lifecycle test item",
            "price": price,
            "category": "Electronics",
            "condition": "good",
            "images": ["https://example.com/order.jpg"],
            "quantity": 5,
        },
        headers=auth(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["item"]


def add_address(token):
    res = client.post(
        "/api/addresses",
        json={
            "label": "Home",
            "full_name": "Test Buyer",
            "phone": "08012345678",
            "line1": "12 Test Street",
            "line2": "Flat 3",
            "city": "Lagos",
            "region": "Lagos",
            "postal_code": "100001",
            "country": "NG",
            "is_default": True,
        },
        headers=auth(token),
    )
    assert res.status_code == 201, res.text
    return res.json()["address"]


def test_cart_checkout_creates_order_and_full_lifecycle():
    buyer_token, buyer = signup("Order Buyer")
    seller_token, seller = signup("Order Seller")
    outsider_token, _outsider = signup("Order Outsider")

    address = add_address(buyer_token)
    item = make_item(seller_token, price=5000)

    added = client.post(
        "/api/payments/cart",
        json={"itemId": item["id"], "quantity": 1},
        headers=auth(buyer_token),
    )
    assert added.status_code == 201, added.text

    checkout = client.post(
        "/api/payments/cart/checkout",
        json={"method": "card", "shippingAddressId": address["id"]},
        headers=auth(buyer_token),
    )
    assert checkout.status_code == 200, checkout.text
    order_id = checkout.json()["orderId"]
    assert order_id

    buyer_orders = client.get("/api/orders?role=buyer", headers=auth(buyer_token))
    assert buyer_orders.status_code == 200, buyer_orders.text
    assert [o["id"] for o in buyer_orders.json()["orders"]] == [order_id]

    seller_orders = client.get("/api/orders?role=seller", headers=auth(seller_token))
    assert seller_orders.status_code == 200, seller_orders.text
    assert [o["id"] for o in seller_orders.json()["orders"]] == [order_id]

    detail = client.get(f"/api/orders/{order_id}", headers=auth(buyer_token))
    assert detail.status_code == 200, detail.text
    order = detail.json()["order"]
    assert order["viewer_role"] == "buyer"
    assert order["shipping_address"]["line1"] == "12 Test Street"
    assert order["items"][0]["title"] == item["title"]
    assert order["status"] == "processing"

    buyer_ship = client.post(
        f"/api/orders/{order_id}/shipments",
        json={"carrier": "DHL"},
        headers=auth(buyer_token),
    )
    assert buyer_ship.status_code == 403

    seller_ship = client.post(
        f"/api/orders/{order_id}/shipments",
        json={
            "carrier": "DHL",
            "service": "Express",
            "trackingNumber": "TRACK-123",
            "trackingUrl": "https://example.com/track/TRACK-123",
        },
        headers=auth(seller_token),
    )
    assert seller_ship.status_code == 201, seller_ship.text
    shipped = seller_ship.json()["order"]
    assert shipped["status"] == "shipped"
    assert shipped["shipments"][0]["tracking_number"] == "TRACK-123"

    buyer_shipment_view = client.get(f"/api/orders/{order_id}", headers=auth(buyer_token)).json()["order"]
    assert buyer_shipment_view["status"] == "shipped"
    assert buyer_shipment_view["shipments"][0]["carrier"] == "DHL"

    seller_confirm = client.post(f"/api/orders/{order_id}/confirm-delivery", headers=auth(seller_token))
    assert seller_confirm.status_code == 403

    confirmed = client.post(f"/api/orders/{order_id}/confirm-delivery", headers=auth(buyer_token))
    assert confirmed.status_code == 200, confirmed.text
    completed = confirmed.json()["order"]
    assert completed["status"] == "completed"
    assert all(item["status"] == "delivered" for item in completed["items"])
    assert all(shipment["status"] == "delivered" for shipment in completed["shipments"])

    txn = db.get("SELECT * FROM transactions WHERE order_id = ?", (order_id,))
    assert txn["status"] == "completed"
    wallet = db.get("SELECT * FROM wallets WHERE user_id = ?", (seller["id"],))
    assert wallet["available_cents"] == 490000

    outsider = client.get(f"/api/orders/{order_id}", headers=auth(outsider_token))
    assert outsider.status_code == 403


def test_direct_checkout_creates_order_and_seller_can_update_shipment():
    buyer_token, buyer = signup("Direct Buyer")
    seller_token, seller = signup("Direct Seller")
    address = add_address(buyer_token)
    item = make_item(seller_token, price=2500)

    intent = client.post(
        "/api/payments/create-intent",
        json={"itemId": item["id"], "method": "card", "shippingAddressId": address["id"]},
        headers=auth(buyer_token),
    )
    assert intent.status_code == 200, intent.text
    body = intent.json()
    assert body["orderId"]
    order_id = body["orderId"]

    shipments = client.post(
        f"/api/orders/{order_id}/shipments",
        json={"carrier": "GIG"},
        headers=auth(seller_token),
    )
    assert shipments.status_code == 201, shipments.text
    shipment_id = shipments.json()["order"]["shipments"][0]["id"]

    in_transit = client.put(
        f"/api/orders/{order_id}/shipments/{shipment_id}",
        json={"status": "in_transit"},
        headers=auth(seller_token),
    )
    assert in_transit.status_code == 200, in_transit.text
    order = in_transit.json()["order"]
    assert order["shipments"][0]["status"] == "in_transit"
    assert order["status"] == "shipped"

    no_carrier = client.post(
        f"/api/orders/{order_id}/shipments",
        json={"trackingNumber": "NO-CARRIER"},
        headers=auth(seller_token),
    )
    assert no_carrier.status_code == 400

    bad_url = client.post(
        f"/api/orders/{order_id}/shipments",
        json={"carrier": "GIG", "trackingUrl": "javascript:alert(1)"},
        headers=auth(seller_token),
    )
    assert bad_url.status_code == 400

    buyer_order = client.get(f"/api/orders/{order_id}", headers=auth(buyer_token)).json()["order"]
    assert buyer_order["buyer"]["id"] == buyer["id"]
    assert buyer_order["viewer_role"] == "buyer"
