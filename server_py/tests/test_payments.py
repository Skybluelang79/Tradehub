import uuid

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.routers.payments import expire_awaiting_payment, get_wallet

client = TestClient(app)


def signup(name, email):
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": "secret123", "username": name.lower().replace(" ", "_")},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


BUYER_TOKEN = None
SELLER_TOKEN = None
BUYER_ID = None
SELLER_ID = None

item_ids = []


def make_item(seller_token, price=5000, payload=None):
    data = {
        "title": f"Pay Item {len(item_ids) + 1}",
        "description": "payment test item",
        "price": price,
        "category": "Electronics",
        "condition": "good",
        "images": ["https://example.com/a.jpg"],
        "quantity": 5,
    }
    if payload:
        data.update(payload)
    res = client.post("/api/items", json=data, headers=auth(seller_token))
    assert res.status_code == 201, res.text
    item = res.json()["item"]
    item_ids.append(item["id"])
    return item


def seed_wallet(user_id, credit_cents):
    get_wallet(user_id)
    db.run("UPDATE wallets SET credit_cents = ? WHERE user_id = ?", (credit_cents, user_id))


def seed_promo(code, discount_value=500, max_uses=3):
    db.run(
        "INSERT INTO promotions (id, code, discount_type, discount_value, max_uses, used_count, active) "
        "VALUES (?, ?, 'fixed', ?, ?, 0, 1)",
        (str(uuid.uuid4()), code, discount_value, max_uses),
    )


def test_setup_users():
    global BUYER_TOKEN, SELLER_TOKEN, BUYER_ID, SELLER_ID
    buyer_token, buyer = signup("Pay Buyer", f"pbuy_{uuid.uuid4().hex[:8]}@test.dev")
    seller_token, seller = signup("Pay Seller", f"psel_{uuid.uuid4().hex[:8]}@test.dev")
    BUYER_TOKEN, SELLER_TOKEN = buyer_token, seller_token
    BUYER_ID, SELLER_ID = buyer["id"], seller["id"]


def test_cart_flow():
    item = make_item(SELLER_TOKEN, price=5000)
    add = client.post("/api/payments/cart", json={"itemId": item["id"], "quantity": 1}, headers=auth(BUYER_TOKEN))
    assert add.status_code == 201, add.text
    assert add.json()["count"] == 1
    assert add.json()["subtotalCents"] == 500000

    add_more = client.post("/api/payments/cart", json={"itemId": item["id"], "quantity": 3}, headers=auth(BUYER_TOKEN))
    assert add_more.status_code == 201
    assert add_more.json()["count"] == 1
    assert add_more.json()["items"][0]["quantity"] == 4
    assert add_more.json()["subtotalCents"] == 2000000

    update = client.put(f"/api/payments/cart/{item['id']}", json={"quantity": 2}, headers=auth(BUYER_TOKEN))
    assert update.json()["items"][0]["quantity"] == 2

    remove = client.delete(f"/api/payments/cart/{item['id']}", headers=auth(BUYER_TOKEN))
    assert remove.status_code == 200
    assert remove.json()["count"] == 0

    clear = client.delete("/api/payments/cart", headers=auth(BUYER_TOKEN))
    assert clear.json()["success"] is True
    assert clear.json()["count"] == 0


def test_cart_validations():
    item = make_item(SELLER_TOKEN)
    own = client.post("/api/payments/cart", json={"itemId": item["id"]}, headers=auth(SELLER_TOKEN))
    assert own.status_code == 400
    assert "own item" in own.json()["error"]
    missing = client.post("/api/payments/cart", json={}, headers=auth(BUYER_TOKEN))
    assert missing.status_code == 400
    not_found = client.post("/api/payments/cart", json={"itemId": "nope"}, headers=auth(BUYER_TOKEN))
    assert not_found.status_code == 404


def test_create_intent_permissions():
    item = make_item(SELLER_TOKEN)
    own = client.post("/api/payments/create-intent", json={"itemId": item["id"]}, headers=auth(SELLER_TOKEN))
    assert own.status_code == 400
    assert "own item" in own.json()["error"]
    missing = client.post("/api/payments/create-intent", json={"itemId": "missing"}, headers=auth(BUYER_TOKEN))
    assert missing.status_code == 404


def test_create_intent_credit_only_and_in_progress():
    item = make_item(SELLER_TOKEN, price=5000)
    seed_wallet(BUYER_ID, 500000)

    res = client.post("/api/payments/create-intent", json={"itemId": item["id"], "method": "credit"}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["method"] == "credit"
    assert body["paid"] is True
    assert body["status"] == "pending"
    assert body["creditCents"] == 500000
    assert body["amountCents"] == 500000
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (body["transactionId"],))
    assert txn["status"] == "pending"
    assert txn["method"] == "credit"
    assert txn["credit_cents"] == 500000
    assert db.get("SELECT * FROM wallets WHERE user_id = ?", (BUYER_ID,))["credit_cents"] == 0

    item2 = make_item(SELLER_TOKEN, price=5000)
    seed_wallet(BUYER_ID, 100000)
    insuff = client.post("/api/payments/create-intent", json={"itemId": item2["id"], "method": "credit"}, headers=auth(BUYER_TOKEN))
    assert insuff.status_code == 402, insuff.text
    assert insuff.json()["creditCents"] == 100000
    assert insuff.json()["amountCents"] == 500000


def test_create_intent_demo_card_reserves_item():
    item = make_item(SELLER_TOKEN, price=5000)
    res = client.post("/api/payments/create-intent", json={"itemId": item["id"], "method": "card"}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("demo") is True
    assert body["status"] == "pending"
    assert body["paid"] is True
    assert body["currency"] == "NGN"
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (body["transactionId"],))
    assert txn["status"] == "pending"
    assert txn["paystack_reference"].startswith("demo_")
    assert db.get("SELECT status FROM items WHERE id = ?", (item["id"],))["status"] == "sold"

    sold = client.post("/api/payments/create-intent", json={"itemId": item["id"], "method": "card"}, headers=auth(BUYER_TOKEN))
    assert sold.status_code == 400
    assert "already sold" in sold.json()["error"]


def test_saved_card_requires_paystack():
    item = make_item(SELLER_TOKEN, price=5000)
    method_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, is_default) "
        "VALUES (?, ?, 'AUTH_CODE_1', 'mastercard', 'credit', '4242', 1)",
        (method_id, BUYER_ID),
    )
    res = client.post(
        "/api/payments/create-intent",
        json={"itemId": item["id"], "method": "card", "paymentMethodId": method_id},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 503
    assert "not configured" in res.json()["error"]


def test_verify_demo_reference():
    item = make_item(SELLER_TOKEN, price=3000)
    intent = client.post("/api/payments/create-intent", json={"itemId": item["id"], "method": "card"}, headers=auth(BUYER_TOKEN)).json()
    txn_id = intent["transactionId"]
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    assert txn["status"] == "pending"  # demo transactions are immediately pending

    # Demo path only triggers for awaiting_payment rows; simulate by flipping status.
    db.run("UPDATE transactions SET status = 'awaiting_payment' WHERE id = ?", (txn_id,))
    verified = client.post(f"/api/payments/verify/{txn['paystack_reference']}", headers=auth(BUYER_TOKEN))
    assert verified.status_code == 200, verified.text
    assert verified.json()["demo"] is True
    assert verified.json()["status"] == "pending"
    assert verified.json()["success"] is True

    repeat = client.post(f"/api/payments/verify/{txn['paystack_reference']}", headers=auth(BUYER_TOKEN))
    assert repeat.json()["alreadyProcessed"] is True


def test_cart_checkout_demo():
    i1 = make_item(SELLER_TOKEN, price=3000)
    i2 = make_item(SELLER_TOKEN, price=2000)
    for iid in (i1["id"], i2["id"]):
        client.post("/api/payments/cart", json={"itemId": iid, "quantity": 1}, headers=auth(BUYER_TOKEN))
    res = client.post("/api/payments/cart/checkout", json={"method": "card"}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body.get("demo") is True
    assert body.get("method") is None
    assert body["paid"] is True
    assert len(body["transactionIds"]) == 2
    assert body["totalCents"] == 500000
    assert body["creditCents"] == 100000
    assert body["count"] == 2
    for tid in body["transactionIds"]:
        txn = db.get("SELECT * FROM transactions WHERE id = ?", (tid,))
        assert txn["status"] == "pending"
        assert txn["paystack_reference"].startswith("demo_")
    cart = client.get("/api/payments/cart", headers=auth(BUYER_TOKEN)).json()
    assert cart["count"] == 0


def test_confirm_receipt_finalizes_and_credits_seller():
    item = make_item(SELLER_TOKEN, price=4000)
    intent = client.post("/api/payments/create-intent", json={"itemId": item["id"], "method": "card"}, headers=auth(BUYER_TOKEN)).json()
    txn_id = intent["transactionId"]

    res = client.post(f"/api/payments/transactions/{txn_id}/confirm-receipt", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200, res.text
    assert res.json()["success"] is True
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    assert txn["status"] == "completed"
    assert txn["fee_amount"] == 160.0
    assert txn["net_amount"] == 3840.0
    wallet = db.get("SELECT * FROM wallets WHERE user_id = ?", (SELLER_ID,))
    assert wallet["available_cents"] == 384000
    assert wallet["lifetime_cents"] == 384000
    assert db.get("SELECT status FROM items WHERE id = ?", (item["id"],))["status"] == "sold"


def test_refund_completed_claws_back_wallet():
    item = make_item(SELLER_TOKEN, price=2000)
    intent = client.post("/api/payments/create-intent", json={"itemId": item["id"], "method": "card"}, headers=auth(BUYER_TOKEN)).json()
    txn_id = intent["transactionId"]
    client.post(f"/api/payments/transactions/{txn_id}/confirm-receipt", headers=auth(BUYER_TOKEN))

    res = client.post(f"/api/payments/refund/{txn_id}", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200, res.text
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    assert txn["status"] == "refunded"
    wallet = db.get("SELECT * FROM wallets WHERE user_id = ?", (SELLER_ID,))
    assert wallet["available_cents"] == 384000  # only the 4000-item net was clawed back
    assert db.get("SELECT status FROM items WHERE id = ?", (item["id"],))["status"] == "active"


def test_transactions_list_and_receipt():
    sent = client.get("/api/payments/transactions?filter=sent", headers=auth(BUYER_TOKEN)).json()["transactions"]
    assert len(sent) >= 3
    received = client.get("/api/payments/transactions?filter=received", headers=auth(BUYER_TOKEN)).json()["transactions"]
    assert received == []
    all_txn = client.get("/api/payments/transactions", headers=auth(BUYER_TOKEN)).json()["transactions"]
    assert len(all_txn) >= 4

    first = all_txn[0]
    receipt = client.get(f"/api/payments/transactions/{first['id']}", headers=auth(BUYER_TOKEN)).json()["receipt"]
    assert receipt["id"] == first["id"]
    assert receipt["item"] is not None
    assert receipt["buyer"]["id"] == BUYER_ID
    assert receipt["seller"]["id"] == SELLER_ID


def test_promo_discount_and_consumption():
    seed_promo("SAVE500")
    item = make_item(SELLER_TOKEN, price=5000)
    res = client.post(
        "/api/payments/create-intent",
        json={"itemId": item["id"], "method": "card", "promoCode": "SAVE500"},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["promo"] == {"code": "SAVE500", "discount": 500}
    assert body["amountCents"] == 450000
    promo_row = db.get("SELECT * FROM promotions WHERE code = 'SAVE500'")
    assert promo_row["used_count"] == 0

    client.post(f"/api/payments/transactions/{body['transactionId']}/confirm-receipt", headers=auth(BUYER_TOKEN))
    promo_row = db.get("SELECT * FROM promotions WHERE code = 'SAVE500'")
    assert promo_row["used_count"] == 1


def test_methods_crud():
    no_details = client.post("/api/payments/methods", json={}, headers=auth(BUYER_TOKEN))
    assert no_details.status_code == 400

    created = client.post(
        "/api/payments/methods",
        json={"brand": "visa", "last4": "1234", "card_type": "credit", "exp_month": 8, "exp_year": 30, "isDefault": True},
        headers=auth(BUYER_TOKEN),
    )
    assert created.status_code == 201, created.text
    method = created.json()["method"]
    assert method["last4"] == "1234"
    assert method["is_default"] == 1

    listed = client.get("/api/payments/methods", headers=auth(BUYER_TOKEN)).json()["methods"]
    assert any(m["id"] == method["id"] for m in listed)
    assert listed[0]["is_default"] == 1

    default = client.put(f"/api/payments/methods/{method['id']}/default", headers=auth(BUYER_TOKEN))
    assert default.json()["success"] is True

    removed = client.delete(f"/api/payments/methods/{method['id']}", headers=auth(BUYER_TOKEN))
    assert removed.json()["success"] is True
    after = [m["id"] for m in client.get("/api/payments/methods", headers=auth(BUYER_TOKEN)).json()["methods"]]
    assert method["id"] not in after
    assert db.get("SELECT id FROM payment_methods WHERE id = ?", (method["id"],)) is None


def test_wallet_and_options():
    wallet = client.get("/api/payments/wallet", headers=auth(BUYER_TOKEN)).json()["wallet"]
    assert wallet["user_id"] == BUYER_ID
    options = client.get("/api/payments/options", headers=auth(BUYER_TOKEN)).json()
    assert options["feePercent"] == 4
    ids = {m["id"] for m in options["methods"]}
    assert "card" in ids and "gift_card" in ids and "bank_transfer" in ids
    assert options["live"] is False


def test_admin_fund_confirmed_flow():
    item = make_item(SELLER_TOKEN, price=1000)
    txn_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, method, status, paystack_reference) "
        "VALUES (?, ?, 'Bank item', 1000, 'NGN', ?, ?, 'bank_transfer', 'awaiting_payment', ?)",
        (txn_id, item["id"], BUYER_ID, SELLER_ID, "BTREF_1"),
    )
    db.run(
        "UPDATE transactions SET bank_account_number = '0123456789', bank_account_name = 'ACME', bank_name = 'Zenith' WHERE id = ?",
        (txn_id,),
    )

    forbidden = client.post(f"/api/payments/admin/fund-confirmed/{txn_id}", headers=auth(SELLER_TOKEN))
    assert forbidden.status_code == 403

    db.run("UPDATE users SET is_admin = 1 WHERE id = ?", (SELLER_ID,))
    ok = client.post(f"/api/payments/admin/fund-confirmed/{txn_id}", headers=auth(SELLER_TOKEN))
    assert ok.status_code == 200, ok.text
    assert db.get("SELECT status FROM transactions WHERE id = ?", (txn_id,))["status"] == "pending"

    bt = client.get("/api/payments/bank-transfer/BTREF_1", headers=auth(BUYER_TOKEN))
    assert bt.status_code == 200, bt.text
    body = bt.json()
    assert body["status"] == "pending"
    assert body["paid"] is True
    assert body["bankTransfer"]["accountNumber"] == "0123456789"
    assert body["bankTransfer"]["reference"] == "BTREF_1"


def test_expire_awaiting_payment_restores_credit():
    item = make_item(SELLER_TOKEN, price=1500)
    txn_id = str(uuid.uuid4())
    seed_wallet(BUYER_ID, 0)
    db.run(
        "INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, method, status, paystack_reference, credit_cents) "
        "VALUES (?, ?, 'Expire me', 1500, 'NGN', ?, ?, 'card', 'awaiting_payment', ?, 150000)",
        (txn_id, item["id"], BUYER_ID, SELLER_ID, "EXP_1"),
    )
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    assert expire_awaiting_payment(txn) is True
    assert db.get("SELECT status FROM transactions WHERE id = ?", (txn_id,))["status"] == "expired"
    assert db.get("SELECT credit_cents FROM wallets WHERE user_id = ?", (BUYER_ID,))["credit_cents"] == 150000