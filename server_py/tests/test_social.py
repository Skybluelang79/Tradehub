import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def signup(name, email, password="secret123"):
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": password,
              "username": name.lower().replace(" ", "_") + "_" + uuid.uuid4().hex[:6]},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


BUYER_TOKEN = None
SELLER_TOKEN = None
buyer_id = None
seller_id = None
item_id = None
conversation_id = None


def test_setup():
    global BUYER_TOKEN, SELLER_TOKEN, buyer_id, seller_id, item_id
    BUYER_TOKEN, buyer = signup("Social Buyer", f"social_buyer_{uuid.uuid4().hex[:8]}@test.dev")
    SELLER_TOKEN, seller = signup("Social Seller", f"social_seller_{uuid.uuid4().hex[:8]}@test.dev")
    buyer_id, seller_id = buyer["id"], seller["id"]

    res = client.post(
        "/api/items",
        json={"title": "Chatty Item", "price": 1000, "category": "Books", "description": "x"},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 201, res.text
    item_id = res.json()["item"]["id"]


def test_favorites_roundtrip():
    res = client.post(f"/api/items/{item_id}/favorite", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200
    assert res.json()["favorited"] is True

    listing = client.get("/api/items/favorites", headers=auth(BUYER_TOKEN))
    assert listing.status_code == 200
    body = listing.json()
    assert item_id in body["favorites"]
    assert any(i["id"] == item_id and i["is_favorite"] for i in body["items"])

    detail = client.get(f"/api/items/{item_id}", headers=auth(BUYER_TOKEN))
    assert detail.json()["item"]["is_favorite"] is True

    res = client.post(f"/api/items/{item_id}/favorite", headers=auth(BUYER_TOKEN))
    assert res.json()["favorited"] is False
    assert client.get("/api/items/favorites", headers=auth(BUYER_TOKEN)).json()["favorites"] == []


def test_favorites_requires_auth():
    assert client.get("/api/items/favorites").status_code == 401


def test_create_item_requires_price():
    res = client.post(
        "/api/items",
        json={"title": "No price", "category": "Misc"},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 400
    assert any("price" in d.lower() for d in res.json()["details"])


def test_create_conversation_validation():
    res = client.post("/api/chat", json={"sellerId": seller_id}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 400

    res = client.post("/api/chat", json={"itemId": item_id, "sellerId": buyer_id}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 400


def test_create_conversation_and_send_message():
    global conversation_id
    res = client.post("/api/chat", json={"itemId": item_id, "sellerId": seller_id}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 201, res.text
    conversation = res.json()["conversation"]
    conversation_id = conversation["id"]
    assert conversation["other_name"] == "Social Seller"

    # Recreating returns the same conversation rather than a duplicate.
    again = client.post("/api/chat", json={"itemId": item_id, "sellerId": seller_id}, headers=auth(BUYER_TOKEN))
    assert again.json()["conversation"]["id"] == conversation_id

    listing = client.get("/api/chat", headers=auth(BUYER_TOKEN))
    assert any(c["id"] == conversation_id for c in listing.json()["conversations"])

    sent = client.post(
        f"/api/chat/{conversation_id}/messages",
        json={"text": "Hello there"},
        headers=auth(BUYER_TOKEN),
    )
    assert sent.status_code == 201, sent.text
    assert sent.json()["message"]["text"] == "Hello there"


def test_messages_and_unread_count():
    count = client.get("/api/chat/unread/count", headers=auth(SELLER_TOKEN))
    assert count.json()["count"] == 1

    res = client.get(f"/api/chat/{conversation_id}/messages", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200
    messages = res.json()["messages"]
    assert len(messages) == 1
    assert messages[0]["sender_name"] == "Social Buyer"

    # Reading clears the unread badge.
    assert client.get("/api/chat/unread/count", headers=auth(SELLER_TOKEN)).json()["count"] == 0


def test_conversation_access_is_restricted():
    outsider_token, _ = signup("Outsider", f"outsider_{uuid.uuid4().hex[:8]}@test.dev")
    res = client.get(f"/api/chat/{conversation_id}/messages", headers=auth(outsider_token))
    assert res.status_code == 403


def test_message_search():
    res = client.get("/api/chat/search?q=Hello", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200
    assert any(m["text"] == "Hello there" for m in res.json()["results"])

    res = client.get(f"/api/chat/{conversation_id}/search?q=Hello", headers=auth(BUYER_TOKEN))
    assert any(m["text"] == "Hello there" for m in res.json()["matches"])


def test_conversation_settings():
    res = client.put(
        f"/api/chat/{conversation_id}/settings",
        json={"pinned": True, "muted": True},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 200
    assert res.json()["settings"] == {"pinned": True, "muted": True}

    fetched = client.get(f"/api/chat/{conversation_id}/settings", headers=auth(BUYER_TOKEN))
    assert fetched.json()["settings"]["pinned"] is True


def test_save_and_fetch_public_key():
    res = client.put("/api/chat/public-key", json={"publicKey": "abc123"}, headers=auth(BUYER_TOKEN))
    assert res.status_code == 200

    peer = client.get(f"/api/chat/{conversation_id}/peer-public-key", headers=auth(SELLER_TOKEN))
    assert peer.status_code == 200
    assert peer.json()["publicKey"] == "abc123"
    assert peer.json()["peerId"] == buyer_id


def test_unsend_own_message_only():
    sent = client.post(
        f"/api/chat/{conversation_id}/messages",
        json={"text": "delete me"},
        headers=auth(BUYER_TOKEN),
    )
    message_id = sent.json()["message"]["id"]

    forbidden = client.post(
        f"/api/chat/{conversation_id}/unsend",
        json={"messageId": message_id},
        headers=auth(SELLER_TOKEN),
    )
    assert forbidden.status_code == 403

    ok = client.post(
        f"/api/chat/{conversation_id}/unsend",
        json={"messageId": message_id},
        headers=auth(BUYER_TOKEN),
    )
    assert ok.status_code == 200


def test_message_notification_created():
    res = client.get("/api/notifications", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200
    notifications = res.json()["notifications"]
    assert any(n["type"] == "message" for n in notifications)

    count = client.get("/api/notifications/unread/count", headers=auth(SELLER_TOKEN))
    assert count.json()["count"] >= 1

    first = notifications[0]["id"]
    read = client.put(f"/api/notifications/{first}/read", headers=auth(SELLER_TOKEN))
    assert read.status_code == 200

    all_read = client.put("/api/notifications/read-all", headers=auth(SELLER_TOKEN))
    assert all_read.status_code == 200
    assert client.get("/api/notifications/unread/count", headers=auth(SELLER_TOKEN)).json()["count"] == 0


def test_notifications_requires_auth():
    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/notifications/unread/count").status_code == 401
