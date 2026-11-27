import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.moderation import find_offplatform_contact

client = TestClient(app)

PASSWORD = "moderationpass123"


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def signup(name):
    email = f"{name.lower().replace(' ', '_')}_{uuid.uuid4().hex[:8]}@test.dev"
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
    body = res.json()
    return body["token"], body["user"]


def make_item(token, description):
    return client.post(
        "/api/items",
        headers=auth(token),
        json={
            "title": f"Moderation Item {uuid.uuid4().hex[:6]}",
            "description": description,
            "price": 5000,
            "category": "Electronics",
            "condition": "good",
            "images": ["https://example.com/item.jpg"],
        },
    )


def test_detector_flags_contact_attempts():
    assert find_offplatform_contact("Call me on 08012345678")
    assert find_offplatform_contact("Message https://wa.me/2348012345678")
    assert find_offplatform_contact("Find me @johndoe_99")
    assert find_offplatform_contact("Instagram: cool.seller")
    assert find_offplatform_contact("dm me first")
    assert find_offplatform_contact("Great condition, barely used") is None
    assert find_offplatform_contact("Price is 50000 naira") is None


def test_listing_description_blocks_contact_details():
    seller, _ = signup("Moderation Seller")

    blocked = make_item(seller, "Nice laptop. WhatsApp me on 08012345678")
    assert blocked.status_code == 400, blocked.text

    allowed = make_item(seller, "Nice laptop in excellent condition")
    assert allowed.status_code == 201, allowed.text


def test_prepurchase_chat_blocks_contact_details():
    buyer, _ = signup("Moderation Buyer")
    seller, seller_user = signup("Chat Moderation Seller")
    item = make_item(seller, "Phone for sale").json()["item"]

    created = client.post(
        "/api/chat",
        headers=auth(buyer),
        json={"itemId": item["id"], "sellerId": seller_user["id"]},
    )
    assert created.status_code == 201, created.text
    conversation_id = created.json()["conversation"]["id"]

    blocked = client.post(
        f"/api/chat/{conversation_id}/messages",
        headers=auth(buyer),
        json={"text": "Contact me @mod buyer"},
    )
    assert blocked.status_code == 400, blocked.text

    allowed = client.post(
        f"/api/chat/{conversation_id}/messages",
        headers=auth(buyer),
        json={"text": "Is this still available?"},
    )
    assert allowed.status_code == 201, allowed.text


def test_offer_message_blocks_contact_details():
    buyer, _ = signup("Moderation Offer Buyer")
    seller, _ = signup("Moderation Offer Seller")
    item = make_item(seller, "Bag for sale").json()["item"]

    blocked = client.post(
        "/api/offers",
        headers=auth(buyer),
        json={
            "itemId": item["id"],
            "amountCents": 400000,
            "message": "Reply on WhatsApp https://wa.me/2348012345678",
        },
    )
    assert blocked.status_code == 400, blocked.text
