import uuid

from fastapi.testclient import TestClient

from app import config, db
from app.main import app
from app.routers.payment_events import log_payment_event

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


def admin_token():
    res = client.post(
        "/api/admin/login",
        json={"email": "admin@tradehub.com", "password": config.ADMIN_PASSWORD},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


BUYER_TOKEN = None
SELLER_TOKEN = None
ADMIN_TOKEN = None
BUYER_ID = None
SELLER_ID = None
ITEM_ID = None
TXN_ID = None


def test_setup_users_and_order():
    global BUYER_TOKEN, SELLER_TOKEN, ADMIN_TOKEN, BUYER_ID, SELLER_ID, ITEM_ID, TXN_ID
    BUYER_TOKEN, buyer = signup("Parity Buyer")
    SELLER_TOKEN, seller = signup("Parity Seller")
    ADMIN_TOKEN = admin_token()
    BUYER_ID, SELLER_ID = buyer["id"], seller["id"]

    res = client.post(
        "/api/items",
        json={
            "title": "Parity Phone",
            "description": "Listing with attributes",
            "price": 1000,
            "category": "Electronics",
            "condition": "good",
            "images": ["https://example.com/phone.jpg"],
        },
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 201, res.text
    ITEM_ID = res.json()["item"]["id"]

    TXN_ID = f"txn_{uuid.uuid4().hex[:8]}"
    db.run(
        """
        INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, method, status, paystack_reference)
        VALUES (?, ?, ?, ?, 'NGN', ?, ?, 'card', 'completed', ?)
        """,
        (TXN_ID, ITEM_ID, "Parity Phone", 1000, BUYER_ID, SELLER_ID, f"demo_{TXN_ID}"),
    )


def test_listing_attributes_search_and_comps():
    res = client.post(
        f"/api/items/{ITEM_ID}/attributes",
        json={"attributes": [{"name": "Brand", "value": "Acme"}, {"name": "Storage", "value": "256GB"}]},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 201, res.text
    assert res.json()["attributes"]["Brand"] == "Acme"

    res = client.get("/api/items", params={"attributes": '{"Brand":"Acme"}'})
    assert res.status_code == 200, res.text
    assert any(item["id"] == ITEM_ID for item in res.json()["items"])

    res = client.post(
        "/api/items",
        json={
            "title": "Comparable Phone",
            "description": "Another listing",
            "price": 1200,
            "category": "Electronics",
            "condition": "like_new",
            "images": [],
        },
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 201, res.text
    comp_id = res.json()["item"]["id"]
    client.post(
        f"/api/items/{comp_id}/attributes",
        json={"attributes": [{"name": "Brand", "value": "Acme"}]},
        headers=auth(SELLER_TOKEN),
    )

    res = client.get(f"/api/items/{ITEM_ID}/comps")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["comps"]
    assert body["averagePrice"] == 1200
    assert any(comp["id"] == comp_id and "Brand" in comp["matchedAttributes"] for comp in body["comps"])


def test_meetup_handoff_flow():
    res = client.post(
        "/api/meetups",
        json={
            "txnId": TXN_ID,
            "scheduledAt": "2030-01-01T10:00:00Z",
            "locationName": "Central Station",
            "address": "1 Main St",
            "latitude": 9.05,
            "longitude": 7.49,
            "note": "Bring the receipt",
        },
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 201, res.text
    meetup = res.json()["meetup"]
    assert meetup["status"] == "proposed"

    res = client.post(f"/api/meetups/{meetup['id']}/accept", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200, res.text
    assert res.json()["meetup"]["status"] == "accepted"

    res = client.post(f"/api/meetups/{meetup['id']}/complete", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    assert res.json()["meetup"]["status"] == "completed"

    res = client.get(f"/api/meetups/transaction/{TXN_ID}", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200, res.text
    assert len(res.json()["meetups"]) == 1


def test_payment_events_log():
    log_payment_event(TXN_ID, BUYER_ID, "test_event", "Verification event", "info", {"step": 1})
    res = client.get(f"/api/payments/events/transaction/{TXN_ID}", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    events = res.json()["events"]
    assert any(event["event_type"] == "test_event" and event["details"] == {"step": 1} for event in events)


def test_returns_flow():
    res = client.post(
        "/api/returns",
        json={"txnId": TXN_ID, "reason": "Item not as described", "note": "Different storage size"},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 201, res.text
    return_id = res.json()["return"]["id"]
    assert res.json()["return"]["rma_number"].startswith("RMA-")

    res = client.post(f"/api/returns/{return_id}/approve", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200, res.text
    assert res.json()["return"]["status"] == "approved"

    res = client.post(f"/api/returns/{return_id}/complete", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    assert res.json()["return"]["status"] == "completed"

    txn = db.get("SELECT status FROM transactions WHERE id = ?", (TXN_ID,))
    assert txn["status"] == "refunded"


def test_strikes_and_appeals():
    res = client.get(f"/api/trust/users/{SELLER_ID}")
    assert res.status_code == 200, res.text
    assert res.json()["trust"]["riskLevel"] == "low"

    res = client.post(
        "/api/trust/strikes",
        json={"userId": SELLER_ID, "reason": "Repeated late handoff", "severity": "high"},
        headers=auth(ADMIN_TOKEN),
    )
    assert res.status_code == 201, res.text
    strike = res.json()["strike"]
    assert strike["points"] == 50

    res = client.post(
        f"/api/trust/strikes/{strike['id']}/appeal",
        json={"reason": "The delay was caused by the buyer"},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 201, res.text
    appeal = res.json()["appeal"]

    res = client.post(
        f"/api/trust/appeals/{appeal['id']}/resolve",
        json={"action": "approve"},
        headers=auth(ADMIN_TOKEN),
    )
    assert res.status_code == 200, res.text

    res = client.get("/api/trust/me", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200, res.text
    trust = res.json()["trust"]
    assert trust["riskScore"] == 0
    assert trust["activeStrikes"] == 0
