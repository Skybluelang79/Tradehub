import io
import uuid

from fastapi.testclient import TestClient
from PIL import Image

from app import vision
from app.main import app

client = TestClient(app)


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def signup(name="Vision User"):
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
    return res.json()["token"]


def make_png(color=(200, 30, 30), size=(120, 80)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def test_vision_status_is_public():
    body = client.get("/api/vision/status").json()
    assert body["imageAnalysis"] is True


def test_analyze_image_and_describe():
    token = signup()
    png = make_png()
    res = client.post(
        "/api/vision/analyze",
        files={"image": ("p.png", png, "image/png")},
        headers=auth(token),
    )
    assert res.status_code == 200, res.text
    analysis = res.json()["analysis"]
    assert analysis["width"] == 120 and analysis["height"] == 80
    assert analysis["orientation"] == "landscape"
    assert analysis["dominantColorName"] == "red"

    described = client.post(
        "/api/vision/describe",
        files={"image": ("p.png", png, "image/png")},
        headers=auth(token),
    )
    assert described.status_code == 200
    assert "image" in described.json()["hints"]


def test_analyze_rejects_corrupt_image():
    token = signup()
    res = client.post(
        "/api/vision/analyze",
        files={"image": ("bad.png", b"not an image", "image/png")},
        headers=auth(token),
    )
    assert res.status_code == 400


def test_analyze_requires_auth():
    png = make_png()
    res = client.post("/api/vision/analyze", files={"image": ("p.png", png, "image/png")})
    assert res.status_code == 401


def test_receipt_ocr_not_configured():
    token = signup()
    res = client.post(
        "/api/vision/receipt",
        files={"image": ("r.png", make_png(), "image/png")},
        headers=auth(token),
    )
    assert res.status_code == 503


def test_parse_receipt_offline():
    text = "ACME STORE\nDate: 2026-01-05\nCashier 4\nTOTAL NGN 1,250.00\nThank you"
    parsed = vision.parse_receipt(text)
    assert parsed["amount"] == 1250.0
    assert parsed["currency"] == "NGN"
    assert parsed["date"] == "2026-01-05"
    assert parsed["merchant"] == "ACME STORE"


def test_parse_receipt_symbol_and_other_date_formats():
    parsed = vision.parse_receipt("Mega Mart\n12/03/2026\nGrand Total: $42.50")
    assert parsed["amount"] == 42.5
    assert parsed["currency"] == "USD"
    assert parsed["date"] == "2026-03-12"
    assert parsed["merchant"] == "Mega Mart"
