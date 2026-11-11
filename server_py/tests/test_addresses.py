import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def signup(name, email):
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": "password123"},
    )
    assert res.status_code == 201, res.text
    return res.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def payload(**overrides):
    data = {
        "label": "Home",
        "full_name": "Address Owner",
        "phone": "+2348000000000",
        "line1": "1 Test Street",
        "line2": "Flat 2",
        "city": "Lagos",
        "region": "Lagos",
        "postal_code": "100001",
        "country": "ng",
    }
    data.update(overrides)
    return data


OWNER_TOKEN = signup("Address Owner", f"address-owner-{uuid.uuid4().hex[:8]}@test.dev")
OTHER_TOKEN = signup("Address Other", f"address-other-{uuid.uuid4().hex[:8]}@test.dev")

first = {}
second = {}


def test_requires_authentication():
    res = client.get("/api/addresses")
    assert res.status_code == 401


def test_rejects_invalid_address():
    res = client.post("/api/addresses", json={"full_name": "No Street"}, headers=auth(OWNER_TOKEN))
    assert res.status_code == 400
    assert res.json()["error"] == "Validation failed"


def test_creates_first_address_as_default():
    res = client.post("/api/addresses", json=payload(), headers=auth(OWNER_TOKEN))
    assert res.status_code == 201, res.text
    body = res.json()["address"]
    assert body["is_default"] is True
    assert body["country"] == "NG"
    first.update(body)


def test_creates_second_address_without_replacing_default():
    res = client.post(
        "/api/addresses",
        json=payload(label="Work", line1="2 Office Road"),
        headers=auth(OWNER_TOKEN),
    )
    assert res.status_code == 201, res.text
    body = res.json()["address"]
    assert body["is_default"] is False
    second.update(body)


def test_lists_addresses_with_default_first():
    res = client.get("/api/addresses", headers=auth(OWNER_TOKEN))
    assert res.status_code == 200
    addresses = res.json()["addresses"]
    assert len(addresses) == 2
    assert addresses[0]["id"] == first["id"]
    assert addresses[0]["is_default"] is True


def test_switches_default_address():
    res = client.post(f"/api/addresses/{second['id']}/default", headers=auth(OWNER_TOKEN))
    assert res.status_code == 200
    assert res.json()["address"]["is_default"] is True

    addresses = client.get("/api/addresses", headers=auth(OWNER_TOKEN)).json()["addresses"]
    by_id = {a["id"]: a for a in addresses}
    assert by_id[first["id"]]["is_default"] is False
    assert by_id[second["id"]]["is_default"] is True


def test_updates_owned_address():
    res = client.put(
        f"/api/addresses/{second['id']}",
        json={"line1": "3 New Office Road", "city": "Abuja", "is_default": True},
        headers=auth(OWNER_TOKEN),
    )
    assert res.status_code == 200
    body = res.json()["address"]
    assert body["line1"] == "3 New Office Road"
    assert body["city"] == "Abuja"
    assert body["is_default"] is True


def test_does_not_expose_addresses_to_another_user():
    assert (
        client.get(f"/api/addresses/{first['id']}", headers=auth(OTHER_TOKEN)).status_code
        == 404
    )
    assert (
        client.put(
            f"/api/addresses/{first['id']}",
            json={"city": "Hijacked"},
            headers=auth(OTHER_TOKEN),
        ).status_code
        == 404
    )
    assert (
        client.delete(f"/api/addresses/{first['id']}", headers=auth(OTHER_TOKEN)).status_code
        == 404
    )


def test_promotes_another_address_when_default_deleted():
    res = client.delete(f"/api/addresses/{second['id']}", headers=auth(OWNER_TOKEN))
    assert res.status_code == 200
    assert res.json()["success"] is True

    addresses = client.get("/api/addresses", headers=auth(OWNER_TOKEN)).json()["addresses"]
    assert len(addresses) == 1
    assert addresses[0]["id"] == first["id"]
    assert addresses[0]["is_default"] is True


def test_enforces_per_user_address_limit():
    for i in range(19):
        res = client.post(
            "/api/addresses",
            json=payload(label=f"Extra {i}", line1=f"{i + 10} Extra Street"),
            headers=auth(OWNER_TOKEN),
        )
        assert res.status_code == 201, res.text

    res = client.post(
        "/api/addresses", json=payload(label="Too many"), headers=auth(OWNER_TOKEN)
    )
    assert res.status_code == 400
    assert "Maximum of 20 addresses" in res.json()["error"]
