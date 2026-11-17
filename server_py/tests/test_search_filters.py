import uuid

from fastapi.testclient import TestClient

from app import db
from app.main import app

client = TestClient(app)

CATEGORY = "Search Gadgets"


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


def create_item(token, title, description, price, condition, location, attributes):
    res = client.post(
        "/api/items",
        headers=auth(token),
        json={
            "title": title,
            "description": description,
            "price": price,
            "category": CATEGORY,
            "condition": condition,
            "location": location,
            "images": ["https://example.com/search.jpg"],
        },
    )
    assert res.status_code == 201, res.text
    item = res.json()["item"]
    attr_res = client.post(
        f"/api/items/{item['id']}/attributes",
        headers=auth(token),
        json={
            "attributes": [
                {"name": name, "value": value} for name, value in attributes.items()
            ]
        },
    )
    assert attr_res.status_code == 201, attr_res.text
    return item["id"]


def test_full_text_search_and_advanced_filters():
    seller_token, seller = signup("Search Seller")
    other_token, other = signup("Search Other")
    db.run("UPDATE users SET rating = 4.8, review_count = 20 WHERE id = ?", (seller["id"],))
    db.run("UPDATE users SET rating = 3.2, review_count = 4 WHERE id = ?", (other["id"],))

    alpha_id = create_item(
        seller_token,
        "Bluewidget Alpha",
        "camera phone accessory",
        10000,
        "new",
        {"lat": 6.5, "lng": 3.4, "address": "Lagos"},
        {"Brand": "Acme", "Size": "M", "Color": "Blue"},
    )
    beta_id = create_item(
        seller_token,
        "Bluewidget Beta",
        "budget accessory",
        5000,
        "good",
        {"lat": 9.0, "lng": 7.0, "address": "Abuja"},
        {"Brand": "Other", "Size": "L"},
    )
    gamma_id = create_item(
        other_token,
        "Greenwidget Gamma",
        "rare collectible",
        7500,
        "fair",
        {"lat": 9.0, "lng": 7.0, "address": "Abuja"},
        {"Brand": "Acme", "Size": "S"},
    )

    params = {"category": CATEGORY, "limit": 20}

    res = client.get("/api/items", params={**params, "search": "bluewidget"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    assert {item["id"] for item in body["items"]} == {alpha_id, beta_id}

    res = client.get("/api/items", params={**params, "q": "camera"})
    assert res.status_code == 200, res.text
    assert [item["id"] for item in res.json()["items"]] == [alpha_id]

    res = client.get("/api/items", params={**params, "search": "bluewidget", "sort": "relevance"})
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 2

    res = client.get("/api/items", params={**params, "conditions": "new,fair"})
    assert res.status_code == 200, res.text
    assert {item["id"] for item in res.json()["items"]} == {alpha_id, gamma_id}

    res = client.get("/api/items", params={**params, "brand": "Acme"})
    assert res.status_code == 200, res.text
    assert {item["id"] for item in res.json()["items"]} == {alpha_id, gamma_id}

    res = client.get("/api/items", params={**params, "size": "M"})
    assert res.status_code == 200, res.text
    assert [item["id"] for item in res.json()["items"]] == [alpha_id]

    res = client.get("/api/items", params={**params, "attributes": '{"Color": "Blue"}'})
    assert res.status_code == 200, res.text
    assert [item["id"] for item in res.json()["items"]] == [alpha_id]

    res = client.get("/api/items", params={**params, "min_rating": 4.5})
    assert res.status_code == 200, res.text
    assert {item["id"] for item in res.json()["items"]} == {alpha_id, beta_id}

    res = client.get(
        "/api/items",
        params={
            **params,
            "max_distance": 50,
            "lat": 6.5,
            "lng": 3.4,
            "limit": 1,
            "page": 1,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert [item["id"] for item in body["items"]] == [alpha_id]

    res = client.get("/api/items", params={**params, "min_price": 6000, "max_price": 8000})
    assert res.status_code == 200, res.text
    assert [item["id"] for item in res.json()["items"]] == [gamma_id]

    res = client.get("/api/items", params={**params, "min_price": 0})
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 3

    res = client.post(
        "/api/searches",
        headers=auth(seller_token),
        json={
            "name": "Blue Acme accessories",
            "query": "bluewidget",
            "category": CATEGORY,
            "filters": {
                "condition": "new",
                "brand": "Acme",
                "size": "M",
                "min_rating": 4.5,
                "attributes": {"Color": "Blue"},
            },
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["search"]["filters"] == {
        "condition": "new",
        "brand": "Acme",
        "size": "M",
        "min_rating": 4.5,
        "attributes": {"Color": "Blue"},
    }

    listed = client.get("/api/searches", headers=auth(seller_token))
    assert listed.status_code == 200, listed.text
    saved = next(s for s in listed.json()["searches"] if s["name"] == "Blue Acme accessories")
    assert saved["filters"]["attributes"] == {"Color": "Blue"}
