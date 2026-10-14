import os
import uuid

from fastapi.testclient import TestClient

from app import config, db
from app.main import app

client = TestClient(app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def signup(name="Ported User"):
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


def test_settings_public_and_update():
    assert client.get("/api/settings/platform").status_code == 200

    token, _ = signup("Settings User")
    assert client.get("/api/settings", headers=auth(token)).status_code == 200

    updated = client.put("/api/settings", json={"dark_mode": True}, headers=auth(token))
    assert updated.status_code == 200, updated.text
    assert updated.json()["settings"]["dark_mode"] == 1

    bad = client.put("/api/settings", json={"currency": "NOPE"}, headers=auth(token))
    assert bad.status_code == 400
    assert bad.json()["error"] == "Unsupported currency"


def test_templates_crud():
    token, _ = signup("Template User")
    created = client.post("/api/templates", json={"name": "My template", "title": "T"}, headers=auth(token))
    assert created.status_code == 201, created.text
    template_id = created.json()["template"]["id"]

    listed = client.get("/api/templates", headers=auth(token)).json()["templates"]
    assert any(t["id"] == template_id for t in listed)

    assert client.post("/api/templates", json={}, headers=auth(token)).status_code == 400
    assert client.delete(f"/api/templates/{template_id}", headers=auth(token)).json()["success"] is True


def test_fcm_token_round_trip():
    token, _ = signup("FCM User")
    assert client.post("/api/fcm/fcm-token", json={"token": "device-1"}, headers=auth(token)).json()["success"] is True
    assert client.post("/api/fcm/fcm-token", json={}, headers=auth(token)).status_code == 400
    assert client.delete("/api/fcm/fcm-token", headers=auth(token)).json()["success"] is True


def test_blocking_flow():
    t1, u1 = signup("Blocker")
    _, u2 = signup("Blocked")

    blocked = client.post("/api/blocking/block", json={"userId": u2["id"]}, headers=auth(t1))
    assert blocked.status_code == 200 and blocked.json()["blocked"] is True

    assert client.get(f"/api/blocking/check/{u2['id']}", headers=auth(t1)).json()["blocked"] is True
    assert any(b["id"] == u2["id"] for b in client.get("/api/blocking/blocked", headers=auth(t1)).json()["blocked"])

    assert client.post("/api/blocking/block", json={"userId": u1["id"]}, headers=auth(t1)).status_code == 400
    assert client.post("/api/blocking/unblock", json={"userId": u2["id"]}, headers=auth(t1)).json()["blocked"] is False


def test_referrals_my():
    token, _ = signup("Referrer")
    body = client.get("/api/referrals/my", headers=auth(token)).json()
    assert body["code"]
    assert body["rewardCents"] == 100000


def test_support_ticket():
    token, _ = signup("Support User")
    created = client.post(
        "/api/reports/support",
        json={"category": "account", "subject": "Help", "message": "Please help me"},
        headers=auth(token),
    )
    assert created.status_code == 201, created.text
    assert client.post("/api/reports/support", json={}, headers=auth(token)).status_code == 400
    assert len(client.get("/api/reports/support", headers=auth(token)).json()["tickets"]) == 1


def test_disputes_list_own():
    token, _ = signup("Dispute User")
    res = client.get("/api/disputes", headers=auth(token))
    assert res.status_code == 200


def test_ai_endpoints_offline():
    token, _ = signup("AI User")
    parsed = client.post("/api/ai/parse", json={"query": "gaming laptop under 5000"})
    assert parsed.status_code == 200, parsed.text
    assert "category" in parsed.json()
    assert client.post("/api/ai/parse", json={}).status_code == 400

    assert client.get("/api/ai/recommendations").json()["items"] is not None
    assert client.post("/api/ai/listing", json={}, headers=auth(token)).status_code == 400


def test_admin_login_and_dashboard():
    token = admin_token()
    assert client.get("/api/admin/dashboard", headers=auth(token)).status_code in (200, 404)


def test_phone_and_webauthn_status():
    token, _ = signup("Auth Extra")
    status = client.get("/api/phone-auth/status", headers=auth(token)).json()
    assert "phoneVerified" in status
    assert client.get("/api/webauthn/credentials", headers=auth(token)).status_code == 200


def test_promotions_flow():
    token = admin_token()
    code = f"SAVE{uuid.uuid4().hex[:5].upper()}"
    created = client.post(
        "/api/promotions",
        json={"code": code, "discount_type": "percentage", "discount_value": 10},
        headers=auth(token),
    )
    assert created.status_code == 201, created.text

    valid = client.post("/api/promotions/validate", json={"code": code, "amount": 1000})
    assert valid.status_code == 200, valid.text
    assert valid.json()["valid"] is True
    assert valid.json()["discount"] == 100

    assert client.post("/api/promotions/validate", json={"code": "NOPE"}).status_code == 400


def test_giftcard_brands_list():
    token, _ = signup("Giftcard User")
    assert client.get("/api/payments/gift-cards/brands", headers=auth(token)).status_code == 200


def test_upload_image():
    token, _ = signup("Uploader")
    res = client.post(
        "/api/upload",
        files={"images": ("pic.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        headers=auth(token),
    )
    assert res.status_code == 200, res.text
    files = res.json()["files"]
    assert len(files) == 1

    path = os.path.join(config.UPLOADS_DIR, files[0]["filename"])
    if os.path.exists(path):
        os.remove(path)

    bad = client.post(
        "/api/upload",
        files={"images": ("evil.exe", b"MZ", "application/octet-stream")},
        headers=auth(token),
    )
    assert bad.status_code == 400
