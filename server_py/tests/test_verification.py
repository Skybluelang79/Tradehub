import uuid

import pytest
from fastapi.testclient import TestClient

from app import db
from app import config as app_config
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_verifications(monkeypatch, tmp_path):
    monkeypatch.setattr(app_config, "UPLOADS_DIR", str(tmp_path))
    yield


def signup(name, email):
    res = client.post(
        "/api/auth/signup",
        json={"name": name, "email": email, "password": "secret123", "username": name.lower().replace(" ", "_")},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    return body["token"], body["user"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def make_valid_payload(id_number="NIN1234567"):
    return {
        "idType": "national_id",
        "idNumber": id_number,
        "idImageUrl": "/uploads/id.png",
        "selfieUrl": "/uploads/selfie.png",
    }


def test_validation_errors():
    token, user = signup("Verify Val", f"val_{uuid.uuid4().hex[:8]}@test.dev")
    headers = auth(token)

    bad_type = client.post("/api/verification", json={**make_valid_payload(), "idType": "birth_cert"}, headers=headers)
    assert bad_type.status_code == 400
    assert "idType must be one of" in bad_type.json()["error"]

    no_number = client.post("/api/verification", json={**make_valid_payload(), "idNumber": "  "}, headers=headers)
    assert no_number.status_code == 400
    assert no_number.json()["error"] == "ID number is required"

    long_number = client.post("/api/verification", json={**make_valid_payload(), "idNumber": "x" * 101}, headers=headers)
    assert long_number.status_code == 400

    bad_image = client.post("/api/verification", json={**make_valid_payload(), "idImageUrl": "https://x/y.png"}, headers=headers)
    assert bad_image.status_code == 400

    bad_selfie = client.post("/api/verification", json={**make_valid_payload(), "selfieUrl": "sel.png"}, headers=headers)
    assert bad_selfie.status_code == 400


def test_submit_queues_pending_when_engine_unconfigured():
    token, user = signup("Verify Pending", f"pend_{uuid.uuid4().hex[:8]}@test.dev")
    res = client.post("/api/verification", json=make_valid_payload("PEND1001"), headers=auth(token))
    assert res.status_code == 201, res.text
    body = res.json()["request"]
    assert body["status"] == "pending"
    assert body["id_type"] == "national_id"
    assert body["id_number"] == "PEND1001"
    assert body["user_id"] == user["id"]
    notif = db.get(
        "SELECT * FROM notifications WHERE user_id = ? AND type = 'verification'", (user["id"],)
    )
    assert notif and "pending review" in notif["body"]

    duplicate = client.post("/api/verification", json=make_valid_payload("PEND1002"), headers=auth(token))
    assert duplicate.status_code == 400
    assert "already have a verification request under review" in duplicate.json()["error"]


def test_status_endpoint():
    token, user = signup("Verify Status", f"stat_{uuid.uuid4().hex[:8]}@test.dev")
    body = client.get("/api/verification/status", headers=auth(token)).json()
    assert body["identityVerified"] is False
    assert body["request"] is None

    client.post("/api/verification", json=make_valid_payload("STAT100"), headers=auth(token))
    body = client.get("/api/verification/status", headers=auth(token)).json()
    assert body["identityVerified"] is False
    assert body["request"]["status"] == "pending"


def test_router_auto_approves_when_engine_says_approved(monkeypatch):
    from app.verification import service as service_mod

    token, user = signup("Verify Auto", f"auto_{uuid.uuid4().hex[:8]}@test.dev")
    fake = service_mod.VerificationResult(
        decision="approved",
        extracted={"docType": "nationalidentitycard", "documentNumber": "AUTO123"},
        checks={"doc_type": {"pass": True}, "number": {"pass": True}, "duplicate": {"pass": True}, "portrait": {"pass": None}},
        notes=["Automated verification passed"],
    )
    monkeypatch.setattr(service_mod, "run_verification", lambda **kw: fake)

    res = client.post("/api/verification", json=make_valid_payload("AUTO123"), headers=auth(token))
    assert res.status_code == 201, res.text
    request = res.json()["request"]
    assert request["status"] == "approved"
    assert request["reviewed_at"] is not None
    assert request["ai_verdict"] == "approved"

    status = client.get("/api/verification/status", headers=auth(token)).json()
    assert status["identityVerified"] is True

    again = client.post("/api/verification", json=make_valid_payload("AUTO123"), headers=auth(token))
    assert again.status_code == 400
    assert "already verified" in again.json()["error"]


def sum_doc(name, number, confidence=0.97, doc_type="passport"):
    return {
        "documents": [
            {
                "docType": doc_type,
                "confidence": confidence,
                "fields": {
                    "DocumentNumber": {"type": "string", "valueString": number, "confidence": confidence},
                    "FirstName": {"type": "string", "valueString": name.split()[0]},
                    "LastName": {"type": "string", "valueString": name.split()[-1]},
                    "DateOfBirth": {"type": "date", "valueDate": "1990-01-01"},
                },
            }
        ],
        "content": f"{name} {number}",
    }


def _enable_azure(monkeypatch):
    from app.verification import service as service_mod
    from app.verification.service import VerificationResult

    monkeypatch.setattr(service_mod, "is_document_intelligence_configured", lambda: True)
    monkeypatch.setattr(service_mod, "is_face_configured", lambda: True)
    return service_mod, VerificationResult


def _write(monkeypatch, name, content=b"fake-png-bytes"):
    import os

    path = os.path.join(app_config.UPLOADS_DIR, name)
    with open(path, "wb") as fh:
        fh.write(content)
    return path


def test_service_auto_approves_document_and_face(monkeypatch):
    service_mod, VerificationResult = _enable_azure(monkeypatch)
    _write(monkeypatch, "id.png")
    _write(monkeypatch, "selfie.png")

    monkeypatch.setattr(service_mod, "analyze_id_document", lambda bytes_: sum_doc("Ada Lovelace", "AB1234567"))
    monkeypatch.setattr(service_mod, "compare_faces", lambda a, b: {"isSameFace": True, "confidence": 0.90})

    result = service_mod.run_verification(
        id_type="passport", id_number="AB1234567", id_image_url="/uploads/id.png",
        selfie_url="/uploads/selfie.png", user_id="u-none",
    )
    assert result.decision == "approved"
    assert result.checks["number"]["pass"] is True
    assert result.checks["doc_type"]["pass"] is True
    assert result.checks["portrait"]["pass"] is True


def test_service_pending_on_number_mismatch(monkeypatch):
    service_mod, VerificationResult = _enable_azure(monkeypatch)
    _write(monkeypatch, "id.png")

    monkeypatch.setattr(service_mod, "analyze_id_document", lambda bytes_: sum_doc("Ada Lovelace", "ZZ9999999"))

    result = service_mod.run_verification(
        id_type="passport", id_number="AB1234567", id_image_url="/uploads/id.png", user_id="u-none"
    )
    assert result.decision == "pending"
    assert result.checks["number"]["pass"] is False
    assert any("manual review" in n for n in result.notes)


def test_service_pending_on_wrong_document_type(monkeypatch):
    service_mod, VerificationResult = _enable_azure(monkeypatch)
    _write(monkeypatch, "id.png")

    monkeypatch.setattr(service_mod, "analyze_id_document", lambda bytes_: sum_doc("Ada Lovelace", "AB1234567", doc_type="driverlicense"))

    result = service_mod.run_verification(
        id_type="passport", id_number="AB1234567", id_image_url="/uploads/id.png", user_id="u-none"
    )
    assert result.decision == "pending"
    assert result.checks["doc_type"]["pass"] is False


def test_service_pending_on_face_mismatch(monkeypatch):
    service_mod, VerificationResult = _enable_azure(monkeypatch)
    _write(monkeypatch, "id.png")
    _write(monkeypatch, "selfie.png")

    monkeypatch.setattr(service_mod, "analyze_id_document", lambda bytes_: sum_doc("Ada Lovelace", "AB1234567"))
    monkeypatch.setattr(service_mod, "compare_faces", lambda a, b: {"isSameFace": False, "confidence": 0.30})

    result = service_mod.run_verification(
        id_type="passport", id_number="AB1234567", id_image_url="/uploads/id.png",
        selfie_url="/uploads/selfie.png", user_id="u-none",
    )
    assert result.decision == "pending"
    assert result.checks["portrait"]["pass"] is False


def test_service_pending_when_unconfigured_still_returns_guarded(monkeypatch):
    import app.verification.azure_client as az
    from app.verification import service as service_mod

    monkeypatch.setattr(az, "is_document_intelligence_configured", lambda: False)
    result = service_mod.run_verification(
        id_type="national_id", id_number="NIN123", id_image_url="/uploads/id.png", user_id="u-none"
    )
    assert result.decision == "skipped"
    assert any("not configured" in n for n in result.notes)


def test_checks_unit():
    from app.verification import checks

    assert checks.normalize_id_number("  aB-1234  ") == "AB1234"
    assert checks.number_matches("AB1234567", ["AB1234567"])
    assert checks.number_matches("ab 1234 567", ["AB1234567"])
    assert not checks.number_matches("AB1111111", ["AB1234567"])
    assert checks.detected_doc_type_matches("passport", "passport")
    assert not checks.detected_doc_type_matches("passport", "driverLicense")
    assert checks.detected_doc_type_matches("other", "whatever")
    assert checks.detected_doc_type_matches("national_id", "nationalIdentityCard")
    assert checks.detected_doc_type_matches("drivers_license", "driverLicense")


def test_duplicate_id_number_detects_other_account(monkeypatch):
    from app.verification import checks

    token, user = signup("Dup Source", f"dupsrc_{uuid.uuid4().hex[:8]}@test.dev")
    client.post("/api/verification", json=make_valid_payload("DUP9001"), headers=auth(token))

    other_token, other_user = signup("Dup Other", f"dupoth_{uuid.uuid4().hex[:8]}@test.dev")
    assert checks.duplicate_id_number("dup 9001", other_user["id"]) is True
    assert checks.duplicate_id_number("NOPE1234", other_user["id"]) is False
