import uuid

from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.routers.payments import get_fee_rate_for_seller
from app.scheduler import run_listing_expiry_sweep

client = TestClient(app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def signup(name):
    email = f"{name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}@test.dev"
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": "secret123", "username": f"u{uuid.uuid4().hex[:8]}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def set_plan(user_id, plan):
    db.run(
        "UPDATE subscriptions SET plan = ?, status = 'active', trial_end = NULL, "
        "current_period_end = datetime('now', '+30 days') WHERE user_id = ?",
        (plan, user_id),
    )


def make_item(token, payload=None, status_code=201):
    data = {
        "title": f"Parity {uuid.uuid4().hex[:8]}",
        "description": "Plan parity item",
        "price": 5000,
        "category": "Electronics",
        "condition": "good",
        "images": ["https://example.com/a.jpg"],
    }
    if payload:
        data.update(payload)
    res = client.post("/api/items", json=data, headers=auth(token))
    assert res.status_code == status_code, res.text
    return res


def test_free_plan_listing_entitlements():
    token, user = signup("Free Entitlements")
    set_plan(user["id"], "free")

    assert get_fee_rate_for_seller(user["id"]) == 0.04

    make_item(token, {"video_url": "https://example.com/video.mp4"}, status_code=403)
    make_item(token, {"images": [f"https://example.com/{i}.jpg" for i in range(7)]}, status_code=403)
    make_item(token, {"boosted": True}, status_code=403)

    distress = make_item(token, {"is_distress": True}).json()["item"]
    assert distress["is_distress"] == 0

    auction = make_item(
        token,
        {"is_auction": True, "starting_bid": 4000, "auction_ends_at": "2099-01-01T00:00:00"},
    ).json()["item"]
    assert auction["status"] == "pending"


def test_gold_plan_listing_entitlements():
    token, user = signup("Gold Entitlements")
    set_plan(user["id"], "premium")

    assert get_fee_rate_for_seller(user["id"]) == 0.02

    item = make_item(
        token,
        {
            "video_url": "https://example.com/video.mp4",
            "is_distress": True,
            "boosted": True,
        },
    ).json()["item"]
    assert item["video_url"] == "https://example.com/video.mp4"
    assert item["is_distress"] == 1
    assert item["boosted"] == 1
    assert item["expires_at"] is not None

    auction = make_item(
        token,
        {"is_auction": True, "starting_bid": 4000, "auction_ends_at": "2099-01-01T00:00:00"},
    ).json()["item"]
    assert auction["status"] == "active"
    assert auction["auction_status"] == "active"


def test_free_listing_limit_and_renew():
    token, user = signup("Free Limit")
    set_plan(user["id"], "free")

    for i in range(30):
        db.run(
            "INSERT INTO items (id, title, price, category, seller_id, status) "
            "VALUES (?, ?, 1000, 'Misc', ?, 'active')",
            (str(uuid.uuid4()), f"Limit {i}", user["id"]),
        )

    make_item(token, status_code=403)

    expired_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status, expires_at, locked_at, lock_reason) "
        "VALUES (?, 'Expired', 1000, 'Misc', ?, 'expired', datetime('now', '-1 day'), datetime('now'), 'Listing duration ended')",
        (expired_id, user["id"]),
    )
    res = client.post(f"/api/items/{expired_id}/renew", headers=auth(token))
    assert res.status_code == 403

    db.run("DELETE FROM items WHERE seller_id = ? AND id != ?", (user["id"], expired_id))
    res = client.post(f"/api/items/{expired_id}/renew", headers=auth(token))
    assert res.status_code == 200, res.text
    renewed = db.get("SELECT * FROM items WHERE id = ?", (expired_id,))
    assert renewed["status"] == "active"
    assert renewed["expires_at"] is not None
    assert renewed["locked_at"] is None
    assert renewed["lock_reason"] is None


def test_listing_expiry_sweep():
    token, user = signup("Expiry Sweep")
    set_plan(user["id"], "premium")

    expiring_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status, expires_at) "
        "VALUES (?, 'Expiring soon', 1000, 'Misc', ?, 'active', datetime('now', '+2 days'))",
        (expiring_id, user["id"]),
    )
    expired_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status, expires_at) "
        "VALUES (?, 'Already expired', 1000, 'Misc', ?, 'active', datetime('now', '-1 hour'))",
        (expired_id, user["id"]),
    )

    run_listing_expiry_sweep()

    warned = db.get("SELECT expiry_warned_at FROM items WHERE id = ?", (expiring_id,))
    assert warned["expiry_warned_at"] is not None
    locked = db.get("SELECT * FROM items WHERE id = ?", (expired_id,))
    assert locked["status"] == "expired"
    assert locked["locked_at"] is not None
    assert locked["lock_reason"] == "Listing duration ended"

    notices = db.all(
        "SELECT title FROM notifications WHERE user_id = ? AND type = 'system'",
        (user["id"],),
    )
    titles = {n["title"] for n in notices}
    assert "Listing Expiring Soon" in titles
    assert "Listing Locked" in titles


def test_pending_plan_webhook_activation(monkeypatch):
    from app import config
    import hashlib
    import hmac
    import json

    token, user = signup("Pending Webhook")
    reference = f"REF_{uuid.uuid4().hex[:10]}"
    db.run(
        "UPDATE subscriptions SET plan = 'free', status = 'active', trial_end = NULL, "
        "pending_plan = 'premium', paystack_reference = ? WHERE user_id = ?",
        (reference, user["id"]),
    )

    monkeypatch.setattr(config, "PAYSTACK_WEBHOOK_SECRET", "testsecret")
    event = {
        "event": "charge.success",
        "data": {
            "reference": reference,
            "customer": {"email": user["email"], "email_token": "etok"},
            "subscription_code": "SUB_PENDING",
        },
    }
    raw = json.dumps(event).encode()
    sig = hmac.new(b"testsecret", raw, hashlib.sha512).hexdigest()
    res = client.post(
        "/api/webhooks/paystack",
        content=raw,
        headers={"x-paystack-signature": sig, "content-type": "application/json"},
    )
    assert res.status_code == 200, res.text

    sub = db.get("SELECT * FROM subscriptions WHERE user_id = ?", (user["id"],))
    assert sub["plan"] == "premium"
    assert sub["pending_plan"] is None
    assert sub["paystack_subscription_code"] == "SUB_PENDING"
