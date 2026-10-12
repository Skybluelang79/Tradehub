import uuid

from fastapi.testclient import TestClient

from app import config, db
from app.main import app
from app.realtime import _format_call_summary

client = TestClient(app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def signup(name="More User"):
    email = f"{name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}@test.dev"
    res = client.post(
        "/api/auth/signup",
        json={
            "name": name,
            "email": email,
            "password": "secret123",
            "username": f"u{uuid.uuid4().hex[:8]}",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def admin_token():
    res = client.post(
        "/api/admin/login",
        json={"email": "admin@tradehub.com", "password": config.ADMIN_PASSWORD},
    )
    assert res.status_code == 200, res.text
    return res.json()["token"]


# ---- Admin --------------------------------------------------------------------


def test_admin_endpoints_require_admin():
    token, _ = signup("Not Admin")
    assert client.get("/api/admin/users", headers=auth(token)).status_code == 403


def test_admin_users_and_system_info():
    admin = admin_token()
    users = client.get("/api/admin/users", headers=auth(admin))
    assert users.status_code == 200, users.text
    assert "users" in users.json()

    info = client.get("/api/admin/system-info", headers=auth(admin))
    assert info.status_code == 200, info.text


# ---- Payouts ------------------------------------------------------------------


def test_payout_balance_and_validation():
    token, _ = signup("Payout User")
    balance = client.get("/api/payouts/balance", headers=auth(token))
    assert balance.status_code == 200
    assert "wallet" in balance.json()

    bad = client.post("/api/payouts", json={"amountCents": 0, "method": "bank"}, headers=auth(token))
    assert bad.status_code == 400


def test_payout_request_cancel_flow():
    token, user = signup("Payout Flow")
    db.run("INSERT OR IGNORE INTO wallets (user_id) VALUES (?)", (user["id"],))
    db.run("UPDATE wallets SET available_cents = 100000 WHERE user_id = ?", (user["id"],))

    created = client.post(
        "/api/payouts",
        json={
            "amountCents": 5000,
            "method": "bank",
            "details": {"accountNumber": "0123456789", "bankCode": "058"},
        },
        headers=auth(token),
    )
    assert created.status_code == 201, created.text
    payout_id = created.json()["payout"]["id"]
    assert created.json()["payout"]["status"] == "pending"

    listed = client.get("/api/payouts", headers=auth(token))
    assert listed.status_code == 200
    assert any(p["id"] == payout_id for p in listed.json()["payouts"])

    cancelled = client.post(f"/api/payouts/{payout_id}/cancel", headers=auth(token))
    assert cancelled.status_code == 200
    assert cancelled.json()["success"] is True


# ---- Gift cards ---------------------------------------------------------------


def test_gift_card_issue_redeem_flow():
    admin = admin_token()
    user_token, user = signup("Gift User")

    issued = client.post(
        "/api/payments/gift-cards/issue",
        json={"amountCents": 5000, "count": 1},
        headers=auth(admin),
    )
    assert issued.status_code == 201, issued.text
    code = issued.json()["codes"][0]

    redeemed = client.post(
        "/api/payments/gift-cards/redeem", json={"code": code}, headers=auth(user_token)
    )
    assert redeemed.status_code == 200, redeemed.text
    assert redeemed.json()["creditCents"] == 5000

    again = client.post(
        "/api/payments/gift-cards/redeem", json={"code": code}, headers=auth(user_token)
    )
    assert again.status_code == 400


def test_dashboard_gift_card_count_excludes_voided():
    admin = admin_token()
    before = client.get("/api/admin/dashboard", headers=auth(admin)).json()["stats"]["giftCardsIssued"]

    issued = client.post(
        "/api/payments/gift-cards/issue",
        json={"amountCents": 1000, "count": 1},
        headers=auth(admin),
    )
    code = issued.json()["codes"][0]
    after_issue = client.get("/api/admin/dashboard", headers=auth(admin)).json()["stats"]["giftCardsIssued"]
    assert after_issue == before + 1

    cards = client.get("/api/payments/gift-cards/list", headers=auth(admin)).json()["cards"]
    card_id = next(c["id"] for c in cards if c["code"] == code)
    voided = client.post(f"/api/payments/gift-cards/{card_id}/void", headers=auth(admin))
    assert voided.status_code == 200, voided.text

    after_void = client.get("/api/admin/dashboard", headers=auth(admin)).json()["stats"]["giftCardsIssued"]
    assert after_void == before


def test_gift_card_brand_admin_only():
    token, _ = signup("Brand User")
    assert client.get("/api/payments/gift-cards/brands/all", headers=auth(token)).status_code == 403

    admin = admin_token()
    created = client.post(
        "/api/payments/gift-cards/brands",
        json={"name": "Test Brand", "category": "retail"},
        headers=auth(admin),
    )
    assert created.status_code == 201, created.text
    assert created.json()["brand"]["name"] == "Test Brand"


# ---- WebAuthn passkey options -------------------------------------------------


def test_webauthn_register_options():
    token, _ = signup("Passkey User")
    res = client.post("/api/webauthn/register/options", headers=auth(token))
    assert res.status_code == 200, res.text
    assert res.json().get("challenge")

    creds = client.get("/api/webauthn/credentials", headers=auth(token))
    assert creds.status_code == 200
    assert creds.json()["credentials"] == []


# ---- Realtime helpers ---------------------------------------------------------


def test_format_call_summary():
    assert _format_call_summary("video", "completed", 65) == "Video call · 1m 5s"
    assert _format_call_summary("audio", "completed", 0) == "Voice call · ended"
    assert _format_call_summary("audio", "cancelled", 10) == "Voice call · cancelled"
    assert _format_call_summary("video", "missed", 0) == "Video call · missed"
    assert _format_call_summary("audio", "rejected", 0) == "Voice call · missed"
