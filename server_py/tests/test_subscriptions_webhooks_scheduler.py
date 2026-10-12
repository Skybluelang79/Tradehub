import hashlib
import hmac
import json
import uuid

from fastapi.testclient import TestClient

from app import config, db
from app.main import app
from app.routers import subscriptions
from app.scheduler import (
    run_abandoned_payment_cleanup,
    run_auction_finalize,
    run_escrow_auto_release,
    run_scheduled_jobs,
)

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


def seed_user_row(name="Seed"):
    uid = str(uuid.uuid4())
    db.run(
        "INSERT INTO users (id, name, email, password, status) VALUES (?, ?, ?, 'x', 'active')",
        (uid, name, f"{name.lower()}_{uuid.uuid4().hex[:8]}@test.dev"),
    )
    return uid


def test_subscription_routes():
    token, user = signup("Sub User")

    # Signup grants a 90-day premium trial.
    current = client.get("/api/subscription/current", headers=auth(token))
    assert current.status_code == 200, current.text
    sub = current.json()["subscription"]
    assert sub["plan"] == "premium"
    assert sub["maxListings"] == -1
    assert sub["isTrial"] is True
    assert sub["daysLeft"] >= 89

    plans = client.get("/api/subscription/plans").json()["plans"]
    assert [p["id"] for p in plans] == ["free", "premium", "pro"]

    benefits = client.get("/api/subscription/benefits", headers=auth(token)).json()
    assert benefits["plan"] == "premium"
    assert len(benefits["benefits"]) == 6

    # dev mode -> upgrade is free
    upgraded = client.post("/api/subscription/upgrade", json={"plan": "pro"}, headers=auth(token))
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["success"] is True
    assert upgraded.json()["subscription"]["plan"] == "pro"

    again = client.post("/api/subscription/upgrade", json={"plan": "pro"}, headers=auth(token))
    assert again.status_code == 400
    assert "Already on" in again.json()["error"]

    cancelled = client.post("/api/subscription/cancel", headers=auth(token))
    assert cancelled.status_code == 200
    assert cancelled.json()["plan"] == "free"
    assert client.post("/api/subscription/cancel", headers=auth(token)).status_code == 400


def test_activate_and_plan_code_cache():
    assert subscriptions.activate_plan("nobody", "bogus") is False
    token, user = signup("Plan Cache")
    assert subscriptions.activate_plan(user["id"], "pro") is True
    subscriptions.write_plan_codes({"pro:NGN": "PLN_test"})
    assert subscriptions.plan_id_for_code("PLN_test") == "pro"
    assert subscriptions.plan_id_for_code("nope") is None


def test_paystack_webhook_signature_and_charge_success(monkeypatch):
    token, buyer = signup("Hook Buyer")

    monkeypatch.setattr(config, "PAYSTACK_WEBHOOK_SECRET", "testsecret")

    # No header -> invalid signature
    bad = client.post("/api/webhooks/paystack", content=b"{}")
    assert bad.status_code == 400
    assert bad.json()["error"] == "Invalid signature"

    item_id = str(uuid.uuid4())
    seller_id = seed_user_row("Hook Seller")
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status) VALUES (?, 'Hook item', 5000, 'Electronics', ?, 'active')",
        (item_id, seller_id),
    )
    ref = "REF_HOOK_1"
    txn_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, method, status, paystack_reference) "
        "VALUES (?, ?, 'Hook item', 5000, 'NGN', ?, ?, 'card', 'awaiting_payment', ?)",
        (txn_id, item_id, buyer["id"], seller_id, ref),
    )

    event = {
        "event": "charge.success",
        "data": {
            "reference": ref,
            "metadata": {"userId": buyer["id"], "plan": "premium"},
            "customer": {"email": buyer["email"], "email_token": "etok"},
            "subscription_code": "SUB_HOOK_1",
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
    assert res.json() == {"received": True}
    assert db.get("SELECT status FROM transactions WHERE id = ?", (txn_id,))["status"] == "pending"
    sub = db.get("SELECT * FROM subscriptions WHERE user_id = ?", (buyer["id"],))
    assert sub["plan"] == "premium"
    assert sub["paystack_subscription_code"] == "SUB_HOOK_1"

    # subscription.disable downgrades it
    raw2 = json.dumps({"event": "subscription.disable", "data": {"subscription_code": "SUB_HOOK_1"}}).encode()
    sig2 = hmac.new(b"testsecret", raw2, hashlib.sha512).hexdigest()
    res2 = client.post("/api/webhooks/paystack", content=raw2, headers={"x-paystack-signature": sig2})
    assert res2.status_code == 200
    assert db.get("SELECT plan FROM subscriptions WHERE user_id = ?", (buyer["id"],))["plan"] == "free"


def test_webhook_secret_not_configured(monkeypatch):
    monkeypatch.setattr(config, "PAYSTACK_WEBHOOK_SECRET", "")
    res = client.post("/api/webhooks/paystack", content=b"{}")
    assert res.status_code == 503


def test_scheduler_jobs():
    buyer_id = seed_user_row("Sched Buyer")
    seller_id = seed_user_row("Sched Seller")

    # Abandoned payment -> expired, store credit restored
    db.run("INSERT INTO wallets (user_id, credit_cents) VALUES (?, 0)", (buyer_id,))
    item1 = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status) VALUES (?, 'Abandoned', 1000, 'Misc', ?, 'active')",
        (item1, seller_id),
    )
    aband_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, method, status, paystack_reference, credit_cents, created_at) "
        "VALUES (?, ?, 'Abandoned', 1000, 'NGN', ?, ?, 'card', 'awaiting_payment', 'AB_1', 100000, datetime('now', '-48 hours'))",
        (aband_id, item1, buyer_id, seller_id),
    )
    run_abandoned_payment_cleanup()
    assert db.get("SELECT status FROM transactions WHERE id = ?", (aband_id,))["status"] == "expired"
    assert db.get("SELECT credit_cents FROM wallets WHERE user_id = ?", (buyer_id,))["credit_cents"] == 100000

    # Pending escrow older than AUTO_RELEASE_DAYS -> completed
    item2 = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status) VALUES (?, 'Release', 2000, 'Misc', ?, 'sold')",
        (item2, seller_id),
    )
    rel_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, method, status, created_at) "
        "VALUES (?, ?, 'Release', 2000, 'NGN', ?, ?, 'card', 'pending', datetime('now', '-30 days'))",
        (rel_id, item2, buyer_id, seller_id),
    )
    run_escrow_auto_release()
    assert db.get("SELECT status FROM transactions WHERE id = ?", (rel_id,))["status"] == "completed"

    # Auction ended with a winning bid -> sale transaction created
    auc_item = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status, is_auction, auction_status, auction_ends_at, current_bid, current_bidder_id) "
        "VALUES (?, 'Auction item', 1000, 'Misc', ?, 'active', 1, 'active', datetime('now', '-1 hour'), 1500, ?)",
        (auc_item, seller_id, buyer_id),
    )
    run_auction_finalize()
    assert db.get("SELECT status FROM items WHERE id = ?", (auc_item,))["status"] == "sold"
    assert db.get("SELECT id FROM transactions WHERE item_id = ? AND method = 'auction'", (auc_item,)) is not None

    # Boost expiry via run_scheduled_jobs
    boost_item = str(uuid.uuid4())
    db.run(
        "INSERT INTO items (id, title, price, category, seller_id, status, boosted, boost_expires_at) "
        "VALUES (?, 'Boosted', 500, 'Misc', ?, 'active', 1, datetime('now', '-1 hour'))",
        (boost_item, seller_id),
    )
    run_scheduled_jobs()
    assert db.get("SELECT boosted FROM items WHERE id = ?", (boost_item,))["boosted"] == 0
