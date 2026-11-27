from fastapi.testclient import TestClient

from app import config
from app.main import app

client = TestClient(app)

EMAIL = "support-user@example.com"
PASSWORD = "supportpass123"


def _signup(email, name):
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": PASSWORD},
    )
    if res.status_code == 409:
        res = client.post(
            "/api/auth/login",
            json={"email": email, "password": PASSWORD},
        )
    assert res.status_code in (200, 201), res.text
    return res.json()["token"]


def test_support_faq_and_bot_reply():
    token = _signup(EMAIL, "Support User")
    auth = {"Authorization": f"Bearer {token}"}

    faq = client.get("/api/support/faq")
    assert faq.status_code == 200
    assert any(item["id"] == "escrow" for item in faq.json()["faqs"])

    created = client.post(
        "/api/support/conversations",
        headers=auth,
        json={"context": "payments", "category": "payment", "message": "How does escrow protect my payment?"},
    )
    assert created.status_code == 201, created.text
    data = created.json()
    thread = data["conversation"]
    assert thread["context"] == "payments"
    assert thread["status"] == "open"
    assert len(data["messages"]) == 2
    assert data["messages"][0]["sender_role"] == "user"
    assert data["messages"][1]["sender_role"] == "bot"
    assert "held by tradehub" in data["messages"][1]["text"].lower()

    unread = client.get("/api/support/unread/count", headers=auth)
    assert unread.json()["count"] == 1

    listed = client.get("/api/support/conversations", headers=auth)
    assert listed.json()["conversations"][0]["id"] == thread["id"]

    messages = client.get(f"/api/support/conversations/{thread['id']}/messages", headers=auth)
    assert len(messages.json()["messages"]) == 2
    assert client.get("/api/support/unread/count", headers=auth).json()["count"] == 0


def test_support_access_control_and_admin_reply():
    token = _signup(EMAIL, "Support User")
    auth = {"Authorization": f"Bearer {token}"}
    other = _signup("support-other@example.com", "Other User")
    other_auth = {"Authorization": f"Bearer {other}"}

    created = client.post(
        "/api/support/conversations",
        headers=auth,
        json={"category": "order", "message": "I need help with my order"},
    ).json()
    thread_id = created["conversation"]["id"]

    assert client.get(f"/api/support/conversations/{thread_id}/messages", headers=other_auth).status_code == 403

    admin_login = client.post(
        "/api/admin/login",
        json={"email": "admin@tradehub.com", "password": config.ADMIN_PASSWORD},
    )
    assert admin_login.status_code == 200, admin_login.text
    admin_auth = {"Authorization": f"Bearer {admin_login.json()['token']}"}

    inbox = client.get("/api/admin/support/conversations", headers=admin_auth)
    assert inbox.status_code == 200
    assert any(item["id"] == thread_id for item in inbox.json()["conversations"])

    reply = client.post(
        f"/api/admin/support/conversations/{thread_id}/messages",
        headers=admin_auth,
        json={"text": "Hi, we are checking your order now."},
    )
    assert reply.status_code == 201, reply.text
    assert reply.json()["message"]["sender_role"] == "admin"

    handoff = client.post(f"/api/support/conversations/{thread_id}/handoff", headers=auth)
    assert handoff.status_code == 200

    bot_stopped = client.post(
        f"/api/support/conversations/{thread_id}/messages",
        headers=auth,
        json={"text": "How does escrow work?"},
    )
    assert bot_stopped.json()["autoReply"] is None

    closed = client.put(
        f"/api/admin/support/conversations/{thread_id}",
        headers=admin_auth,
        json={"status": "closed"},
    )
    assert closed.status_code == 200
    blocked = client.post(
        f"/api/support/conversations/{thread_id}/messages",
        headers=auth,
        json={"text": "Still need help"},
    )
    assert blocked.status_code == 409
