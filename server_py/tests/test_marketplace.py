import uuid

from fastapi.testclient import TestClient

from app import db
from app.main import app

client = TestClient(app)


def signup(name, email, password):
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": password, "username": name.lower().replace(" ", "_")},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def make_item(seller_token, payload=None, status_code=201):
    data = {
        "title": "Test Item",
        "description": "A test item",
        "price": 5000,
        "category": "Electronics",
        "condition": "good",
        "images": ["https://example.com/a.jpg"],
        "variants": [{"name": "Size", "values": ["M", "L"]}],
        "quantity": 2,
    }
    if payload:
        data.update(payload)
    res = client.post("/api/items", json=data, headers=auth(seller_token))
    assert res.status_code == status_code, res.text
    return res


BUYER_TOKEN = None
SELLER_TOKEN = None

item_id = None
seller_id = None
buyer_id = None


def test_setup_users():
    global BUYER_TOKEN, SELLER_TOKEN, buyer_id, seller_id
    buyer_token, buyer = signup("Market Buyer", f"buyer_{uuid.uuid4().hex[:8]}@test.dev", "secret123")
    seller_token, seller = signup("Market Seller", f"seller_{uuid.uuid4().hex[:8]}@test.dev", "secret123")
    BUYER_TOKEN, SELLER_TOKEN = buyer_token, seller_token
    buyer_id, seller_id = buyer["id"], seller["id"]


def test_create_item_and_get():
    global item_id
    res = make_item(SELLER_TOKEN)
    item = res.json()["item"]
    item_id = item["id"]
    assert item["title"] == "Test Item"
    assert item["images"] == ["https://example.com/a.jpg"]
    assert item["seller_id"] == seller_id
    assert item["quantity"] == 2

    detail = client.get(f"/api/items/{item_id}")
    assert detail.status_code == 200
    body = detail.json()["item"]
    assert body["category"] == "Electronics"
    assert body["variants"] == [{"name": "Size", "values": ["M", "L"]}]
    assert body["is_favorite"] is False
    assert body["sale_active"] is False
    assert body["seller_name"] == "Market Seller"
    assert "similar_items" in body
    assert body["views"] == 0


def test_create_item_validation():
    res = client.post("/api/items", json={}, headers=auth(SELLER_TOKEN))
    assert res.status_code == 400
    body = res.json()
    assert body["error"] == "Validation failed"
    assert len(body["details"]) >= 2

    res = client.post(
        "/api/items",
        json={"title": "X", "category": "Toy", "price": -5},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 400
    assert "price: Price must be positive" in res.json()["details"]


def test_list_items_filters():
    res = client.get("/api/items", params={"category": "Electronics", "sort": "popular"})
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert any(i["id"] == item_id for i in body["items"])
    assert body["items"][0]["seller_plan"] in ("premium", "pro", "free", "trial")

    res = client.get("/api/items", params={"search": "nonexistent-xyz", "page": 1, "limit": 5})
    assert res.json()["total"] == 0

    res = client.get("/api/items", params={"limit": 2, "sort": "price_high"})
    assert len(res.json()["items"]) <= 2

    bad_token = client.get(
        "/api/items", headers={"Authorization": "Bearer not-a-real-token"}
    )
    assert bad_token.status_code == 200


def test_favorite_toggle_and_bulk():
    res = client.post(f"/api/items/{item_id}/favorite", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200
    assert res.json() == {"favorited": True}

    detail = client.get(f"/api/items/{item_id}", headers=auth(BUYER_TOKEN)).json()["item"]
    assert detail["is_favorite"] is True
    assert detail["favorites"] == 1

    res = client.post(f"/api/items/{item_id}/favorite", headers=auth(BUYER_TOKEN))
    assert res.json() == {"favorited": False}

    res = client.put(
        "/api/items/bulk/update",
        json={"ids": [item_id], "updates": {"price": 4500, "status": "active"}},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 200
    assert res.json()["updated"] == 1
    assert client.get(f"/api/items/{item_id}").json()["item"]["price"] == 4500

    res = client.put(
        "/api/items/bulk/update", json={"ids": [item_id], "updates": {}}, headers=auth(SELLER_TOKEN)
    )
    assert res.status_code == 400


def test_update_item_permissions():
    res = client.put(
        f"/api/items/{item_id}",
        json={"price": 9999},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 403

    res = client.put(
        f"/api/items/{item_id}",
        json={"price": 8888, "images": ["https://example.com/b.png"]},
        headers=auth(SELLER_TOKEN),
    )
    assert res.status_code == 200
    body = res.json()["item"]
    assert body["price"] == 8888
    assert body["images"] == ["https://example.com/b.png"]
    assert body["title"] == "Test Item"


def test_drafts_user_items_and_categories():
    draft = make_item(SELLER_TOKEN, {"title": "Draft Item", "status": "draft", "price": 100})
    draft_id = draft.json()["item"]["id"]

    drafts = client.get(f"/api/items/user/{seller_id}/drafts", headers=auth(SELLER_TOKEN))
    assert drafts.status_code == 200
    assert any(i["id"] == draft_id for i in drafts.json()["items"])

    res = client.get(f"/api/items/user/{seller_id}/drafts", headers=auth(BUYER_TOKEN))
    assert res.status_code == 403

    active = client.get(f"/api/items/user/{seller_id}")
    assert all(i["status"] != "draft" for i in active.json()["items"])

    cats = client.get("/api/items/categories/overview")
    assert cats.status_code == 200
    assert any(c["category"] == "Electronics" for c in cats.json()["categories"])


def test_bids_and_place_bid():
    res = make_item(SELLER_TOKEN, {
        "title": "Auction Item",
        "is_auction": True,
        "starting_bid": 100,
        "min_increment": 5,
        "price": 100,
    })
    auction_id = res.json()["item"]["id"]

    bids = client.get(f"/api/items/{auction_id}/bids")
    assert bids.status_code == 200
    assert bids.json()["bids"] == []

    bids = client.get(f"/api/items/{item_id}/bids")
    assert bids.status_code == 400

    low = client.post(f"/api/items/{auction_id}/bid", json={"amount": 100}, headers=auth(BUYER_TOKEN))
    assert low.status_code == 400
    assert "Bid must be at least" in low.json()["error"]

    bid = client.post(f"/api/items/{auction_id}/bid", json={"amount": 150}, headers=auth(BUYER_TOKEN))
    assert bid.status_code == 201
    assert bid.json()["current_bid"] == 150

    own = client.post(f"/api/items/{auction_id}/bid", json={"amount": 200}, headers=auth(SELLER_TOKEN))
    assert own.status_code == 400
    assert own.json()["error"] == "You cannot bid on your own auction"

    bad = client.post(f"/api/items/{auction_id}/bid", json={"amount": 0}, headers=auth(BUYER_TOKEN))
    assert bad.status_code == 400

    bids = client.get(f"/api/items/{auction_id}/bids").json()["bids"]
    assert bids[0]["amount"] == 150
    assert bids[0]["bidder_name"] == "Market Buyer"

    related = client.get(f"/api/items/{auction_id}/related")
    assert related.status_code == 200
    assert set(related.json()["items"][0].keys()) >= {"id", "title", "price", "image"}


def test_mark_sold_and_relist():
    sold = client.post(f"/api/items/{item_id}/mark-sold", headers=auth(SELLER_TOKEN))
    assert sold.status_code == 200
    assert sold.json()["status"] == "sold"

    relist = client.post(f"/api/items/{item_id}/relist", headers=auth(SELLER_TOKEN))
    assert relist.status_code == 200
    assert relist.json()["status"] == "active"

    again = client.post(f"/api/items/{item_id}/relist", headers=auth(SELLER_TOKEN))
    assert again.status_code == 400


def test_premium_sellers():
    sub_id = str(uuid.uuid4())
    db.run(
        "INSERT OR REPLACE INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'premium', 'active')",
        (sub_id, seller_id),
    )
    res = client.get("/api/items/premium/sellers")
    assert res.status_code == 200
    sellers = res.json()["sellers"]
    assert any(s["id"] == seller_id and s["badge"] == "Premium Seller" for s in sellers)


def test_reviews():
    res = client.post(
        "/api/reviews",
        json={"revieweeId": seller_id, "rating": 5},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 403
    assert res.json()["error"] == "You can only review a user after a completed transaction"

    db.run(
        "INSERT INTO transactions (id, item_id, item_title, amount, currency, buyer_id, seller_id, status, completed_at) "
        "VALUES (?, ?, ?, ?, 'NGN', ?, ?, 'completed', datetime('now'))",
        (str(uuid.uuid4()), item_id, "Test Item", 5000, buyer_id, seller_id),
    )

    res = client.post(
        "/api/reviews",
        json={"revieweeId": seller_id, "itemId": item_id, "rating": 5, "text": "Great!"},
        headers=auth(BUYER_TOKEN),
    )
    assert res.status_code == 201
    review = res.json()["review"]
    assert review["verified"] == 1
    assert review["reviewer_name"] == "Market Buyer"

    self_rev = client.post(
        "/api/reviews",
        json={"revieweeId": buyer_id, "rating": 5},
        headers=auth(BUYER_TOKEN),
    )
    assert self_rev.status_code == 400

    bad_rating = client.post(
        "/api/reviews",
        json={"revieweeId": seller_id, "itemId": item_id, "rating": 6},
        headers=auth(BUYER_TOKEN),
    )
    assert bad_rating.status_code == 400

    listed = client.get(f"/api/reviews/user/{seller_id}")
    assert listed.status_code == 200
    assert any(r["id"] == review["id"] for r in listed.json()["reviews"])

    me = db.get("SELECT rating, review_count FROM users WHERE id = ?", (seller_id,))
    assert me["review_count"] >= 1


def test_offers_flow():
    res = make_item(SELLER_TOKEN, {"title": "Offer Item", "price": 10000})
    offer_item_id = res.json()["item"]["id"]

    bad = client.post("/api/offers", json={"itemId": offer_item_id, "amountCents": 0}, headers=auth(BUYER_TOKEN))
    assert bad.status_code == 400
    assert bad.json()["error"] == "Offer amount must be greater than 0"

    created = client.post(
        "/api/offers",
        json={"itemId": offer_item_id, "amountCents": 850000, "message": "Hi seller"},
        headers=auth(BUYER_TOKEN),
    )
    assert created.status_code == 201
    offer = created.json()["offer"]
    assert offer["item_title"] == "Offer Item"
    assert offer["item_price"] == 10000
    assert offer["buyer_name"] == "Market Buyer"
    assert offer["status"] == "pending"

    dup = client.post(
        "/api/offers",
        json={"itemId": offer_item_id, "amountCents": 900000},
        headers=auth(BUYER_TOKEN),
    )
    assert dup.status_code == 400
    assert dup.json()["error"] == "You already have a pending offer on this item"

    incoming = client.get("/api/offers/incoming", headers=auth(SELLER_TOKEN)).json()["offers"]
    assert any(o["id"] == offer["id"] for o in incoming)

    outgoing = client.get("/api/offers/outgoing", headers=auth(BUYER_TOKEN)).json()["offers"]
    assert any(o["id"] == offer["id"] for o in outgoing)

    item_offers = client.get(f"/api/offers/item/{offer_item_id}", headers=auth(SELLER_TOKEN))
    assert item_offers.status_code == 200
    assert len(item_offers.json()["offers"]) == 1

    forbidden = client.get(f"/api/offers/item/{offer_item_id}", headers=auth(BUYER_TOKEN))
    assert forbidden.status_code == 403

    bad_len = client.post(
        "/api/offers",
        json={"itemId": offer_item_id, "amountCents": 850000, "message": "x" * 600},
        headers=auth(BUYER_TOKEN),
    )
    assert bad_len.status_code == 400


def test_offer_accept():  # noqa: F811
    res = make_item(SELLER_TOKEN, {"title": "Accept Item", "price": 8000})
    a_item_id = res.json()["item"]["id"]

    created = client.post(
        "/api/offers", json={"itemId": a_item_id, "amountCents": 700000}, headers=auth(BUYER_TOKEN)
    ).json()["offer"]

    ok = client.post(f"/api/offers/{created['id']}/accept", headers=auth(SELLER_TOKEN))
    assert ok.status_code == 200
    assert ok.json()["offer"]["status"] == "accepted"

    item = client.get(f"/api/items/{a_item_id}").json()["item"]
    assert item["status"] == "sold"
    assert item["sold_to"] == buyer_id

    again = client.post(f"/api/offers/{created['id']}/accept", headers=auth(SELLER_TOKEN))
    assert again.status_code == 400
    assert again.json()["error"] == "Offer is already accepted"

    res = make_item(SELLER_TOKEN, {"title": "Wrong Party", "price": 3000})
    wp_item = res.json()["item"]["id"]
    wp_offer = client.post(
        "/api/offers", json={"itemId": wp_item, "amountCents": 200000}, headers=auth(BUYER_TOKEN)
    ).json()["offer"]
    wrong = client.post(f"/api/offers/{wp_offer['id']}/accept", headers=auth(BUYER_TOKEN))
    assert wrong.status_code == 403
    assert wrong.json()["error"] == "Not authorized to accept this offer"


def test_offer_decline_counter_cancel():
    res = make_item(SELLER_TOKEN, {"title": "Counter Item", "price": 9000})
    c_item_id = res.json()["item"]["id"]

    declined = client.post(
        "/api/offers", json={"itemId": c_item_id, "amountCents": 500000}, headers=auth(BUYER_TOKEN)
    ).json()["offer"]
    resp = client.post(f"/api/offers/{declined['id']}/decline", json={"note": "No thanks"}, headers=auth(SELLER_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["offer"]["status"] == "declined"
    assert resp.json()["offer"]["responder_note"] == "No thanks"

    countered = client.post(
        "/api/offers", json={"itemId": c_item_id, "amountCents": 600000}, headers=auth(BUYER_TOKEN)
    ).json()["offer"]
    resp = client.post(
        f"/api/offers/{countered['id']}/counter",
        json={"amountCents": 650000, "message": "How about 6500?"},
        headers=auth(SELLER_TOKEN),
    )
    assert resp.status_code == 201
    new_offer = resp.json()["offer"]
    assert new_offer["offered_by"] == "seller"
    assert new_offer["parent_offer_id"] == countered["id"]
    assert new_offer["amount_cents"] == 650000
    old = client.get("/api/offers/incoming", headers=auth(SELLER_TOKEN))
    assert any(o["id"] == countered["id"] and o["status"] == "countered" for o in old.json()["offers"])

    bad_counter = client.post(
        f"/api/offers/{countered['id']}/counter", json={"amountCents": 0}, headers=auth(SELLER_TOKEN)
    )
    assert bad_counter.status_code == 400

    res = make_item(SELLER_TOKEN, {"title": "Cancel Item", "price": 7000})
    cancel_item_id = res.json()["item"]["id"]
    cancel = client.post(
        "/api/offers", json={"itemId": cancel_item_id, "amountCents": 400000}, headers=auth(BUYER_TOKEN)
    ).json()["offer"]
    resp = client.post(f"/api/offers/{cancel['id']}/cancel", headers=auth(BUYER_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["offer"]["status"] == "cancelled"

    not_found = client.post(f"/api/offers/{uuid.uuid4()}/accept", headers=auth(SELLER_TOKEN))
    assert not_found.status_code == 404


def test_searches_crud():
    created = client.post(
        "/api/searches",
        json={"name": "Cheap phones", "query": "iphone", "category": "Electronics", "max_price": 50000},
        headers=auth(BUYER_TOKEN),
    )
    assert created.status_code == 200
    search = created.json()["search"]
    assert search["name"] == "Cheap phones"
    assert search["max_price"] == 50000

    listed = client.get("/api/searches", headers=auth(BUYER_TOKEN))
    assert any(s["id"] == search["id"] for s in listed.json()["searches"])

    blank = client.post("/api/searches", json={}, headers=auth(BUYER_TOKEN))
    assert blank.status_code == 200
    assert blank.json()["search"]["name"] == "Untitled search"

    updated = client.put(
        f"/api/searches/{search['id']}",
        json={"name": "New name", "min_price": 1000},
        headers=auth(BUYER_TOKEN),
    )
    assert updated.status_code == 200
    assert updated.json()["search"]["name"] == "New name"
    assert updated.json()["search"]["min_price"] == 1000

    missing = client.put(f"/api/searches/{uuid.uuid4()}", json={}, headers=auth(BUYER_TOKEN))
    assert missing.status_code == 404

    deleted = client.delete(f"/api/searches/{search['id']}", headers=auth(BUYER_TOKEN))
    assert deleted.status_code == 200
    assert deleted.json() == {"success": True}


def test_follows_flow():
    res = client.post(f"/api/follows/{seller_id}/follow", headers=auth(BUYER_TOKEN))
    assert res.status_code == 200
    assert res.json()["isFollowing"] is True
    assert res.json()["followerCount"] >= 1

    self_follow = client.post(f"/api/follows/{buyer_id}/follow", headers=auth(BUYER_TOKEN))
    assert self_follow.status_code == 400

    missing = client.post(f"/api/follows/{uuid.uuid4()}/follow", headers=auth(BUYER_TOKEN))
    assert missing.status_code == 404

    status = client.get(f"/api/follows/status/{seller_id}", headers=auth(BUYER_TOKEN))
    assert status.status_code == 200
    assert status.json()["isFollowing"] is True
    assert status.json()["followerCount"] >= 1

    counts = client.get(f"/api/follows/counts/{seller_id}")
    assert counts.status_code == 200
    assert counts.json()["followerCount"] >= 1

    following = client.get("/api/follows/following", headers=auth(BUYER_TOKEN)).json()["following"]
    assert any(f["id"] == seller_id for f in following)
    assert "follower_count" in following[0]

    followers = client.get("/api/follows/followers", headers=auth(SELLER_TOKEN)).json()["followers"]
    assert any(f["id"] == buyer_id for f in followers)

    storefront = client.get(f"/api/follows/storefront/{seller_id}", headers=auth(BUYER_TOKEN))
    assert storefront.status_code == 200
    body = storefront.json()
    assert body["user"]["name"] == "Market Seller"
    assert body["isFollowing"] is True
    assert body["stats"]["total_listings"] >= 1
    assert all("images" in i for i in body["listings"])

    unfollow = client.delete(f"/api/follows/{seller_id}/follow", headers=auth(BUYER_TOKEN))
    assert unfollow.status_code == 200
    assert unfollow.json()["isFollowing"] is False


def test_delete_item():
    res = make_item(SELLER_TOKEN, {"title": "Delete Me", "price": 100})
    to_delete = res.json()["item"]["id"]

    res = client.delete(f"/api/items/{to_delete}", headers=auth(BUYER_TOKEN))
    assert res.status_code == 403

    res = client.delete(f"/api/items/{to_delete}", headers=auth(SELLER_TOKEN))
    assert res.status_code == 200
    assert res.json() == {"success": True}

    res = client.get(f"/api/items/{to_delete}")
    assert res.status_code == 404

    res = client.delete(f"/api/items/{to_delete}", headers=auth(SELLER_TOKEN))
    assert res.status_code == 404