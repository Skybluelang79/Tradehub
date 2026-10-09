from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

EMAIL = "porter@example.com"
PASSWORD = "secret123"

SIGNUP_VERIFY_TOKEN = None


def test_signup():
    global SIGNUP_VERIFY_TOKEN
    res = client.post(
        "/api/auth/signup",
        json={"name": "Test Porter", "email": EMAIL, "password": PASSWORD, "username": "porter"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["token"]
    assert body["refreshToken"]
    assert body["user"]["email"] == EMAIL
    assert "password" not in body["user"]
    assert body["devVerifyToken"]
    SIGNUP_VERIFY_TOKEN = body["devVerifyToken"]


def test_signup_duplicate():
    res = client.post(
        "/api/auth/signup",
        json={"name": "Other", "email": EMAIL, "password": "secret123"},
    )
    assert res.status_code == 409
    assert res.json()["error"] == "Email already registered"


def test_signup_validation():
    res = client.post("/api/auth/signup", json={"name": "", "email": "nope", "password": "x"})
    assert res.status_code == 400
    assert res.json()["error"] == "Validation failed"
    assert len(res.json()["details"]) >= 3


def test_login_and_me():
    res = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert res.status_code == 200
    token = res.json()["token"]
    assert res.json()["user"]["id"]
    assert "password" not in res.json()["user"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["user"]["email"] == EMAIL
    assert "isAdmin" in me.json()["user"]


def test_login_bad_password():
    res = client.post(
        "/api/auth/login", json={"email": EMAIL, "password": "wrongwrong"}
    )
    assert res.status_code == 401
    assert res.json()["error"] == "Invalid email or password"


def test_me_requires_token():
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.get(
            "/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"}
        ).status_code
        == 403
    )


def test_refresh_and_logout():
    res = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    refresh_token = res.json()["refreshToken"]

    refreshed = client.post("/api/auth/refresh", json={"refreshToken": refresh_token})
    assert refreshed.status_code == 200
    assert refreshed.json()["token"]
    assert refreshed.json()["refreshToken"]
    assert refreshed.json()["refreshToken"] != refresh_token

    dead = client.post("/api/auth/refresh", json={"refreshToken": refresh_token})
    assert dead.status_code == 401

    token = res.json()["token"]
    logout = client.post(
        "/api/auth/logout",
        json={"refreshToken": refreshed.json()["refreshToken"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logout.status_code == 200
    assert logout.json()["success"] is True


def test_change_password_and_verify_email():
    res = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    token = res.json()["token"]

    changed = client.put(
        "/api/auth/change-password",
        json={"currentPassword": PASSWORD, "newPassword": "newpass456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert changed.status_code == 200

    bad_old = client.put(
        "/api/auth/change-password",
        json={"currentPassword": "nope", "newPassword": "newpass456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert bad_old.status_code == 401

    old_login = client.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    assert old_login.status_code == 401

    new_login = client.post("/api/auth/login", json={"email": EMAIL, "password": "newpass456"})
    assert new_login.status_code == 200
    token = new_login.json()["token"]

    verified = client.post("/api/auth/verify-email", json={"token": SIGNUP_VERIFY_TOKEN})
    assert verified.status_code == 200
    assert verified.json()["message"] == "Email verified successfully"

    again = client.post("/api/auth/verify-email", json={"token": SIGNUP_VERIFY_TOKEN})
    assert again.status_code == 400


def test_search_and_batch_and_profile():
    res = client.post("/api/auth/login", json={"email": EMAIL, "password": "newpass456"})
    user = res.json()["user"]
    token = res.json()["token"]

    short = client.get("/api/auth/search?q=a")
    assert short.status_code == 400

    search = client.get("/api/auth/search", params={"q": "porter"})
    assert search.status_code == 200
    assert any(u["id"] == user["id"] for u in search.json()["users"])

    batch = client.get("/api/auth/batch", params={"ids": user["id"]})
    assert batch.status_code == 200
    assert batch.json()["users"][0]["id"] == user["id"]

    profile = client.get(f"/api/auth/{user['id']}/profile")
    assert profile.status_code == 200
    assert profile.json()["user"]["id"] == user["id"]
    assert "stats" in profile.json()

    res = client.put(
        "/api/auth/me",
        json={"name": "Porter Renamed", "location": {"address": "Lagos", "lat": 6.45, "lng": 3.39}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert res.json()["user"]["name"] == "Porter Renamed"
    assert res.json()["user"]["location_address"] == "Lagos"

    renamed = client.get("/api/auth/search", params={"q": "porter"})
    assert any(u["id"] == user["id"] for u in renamed.json()["users"])


def test_forgot_and_reset_password():
    res = client.post("/api/auth/forgot-password", json={"email": EMAIL})
    assert res.status_code == 200
    assert "devResetToken" in res.json()

    token = res.json()["devResetToken"]
    ok = client.post("/api/auth/reset-password", json={"token": token, "password": "fresh1234"})
    assert ok.status_code == 200

    login = client.post("/api/auth/login", json={"email": EMAIL, "password": "fresh1234"})
    assert login.status_code == 200

    reuse = client.post("/api/auth/reset-password", json={"token": token, "password": "fresh1234"})
    assert reuse.status_code == 400


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}