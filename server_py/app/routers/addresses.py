import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user
from ..validation import raise_validation

router = APIRouter()

MAX_ADDRESSES = 20
ADDRESS_FIELDS = (
    "label",
    "full_name",
    "phone",
    "line1",
    "line2",
    "city",
    "region",
    "postal_code",
    "country",
)
REQUIRED_FIELDS = {
    "full_name": "Full name is required",
    "line1": "Address line 1 is required",
    "city": "City is required",
}


def _normalize(row):
    if not row:
        return None
    return {**row, "is_default": bool(row["is_default"])}


def _owned(address_id, user_id):
    return db.get(
        "SELECT * FROM addresses WHERE id = ? AND user_id = ?", (address_id, user_id)
    )


def _validate(body, partial=False):
    details = []
    if not partial:
        for field, message in REQUIRED_FIELDS.items():
            value = str(body.get(field) or "").strip()
            if not value:
                details.append(f"{field}: {message}")
    if "country" in body and body.get("country") not in (None, ""):
        country = str(body["country"]).strip()
        if len(country) < 2:
            details.append("country: Country is required")
    if details:
        raise_validation(details)


def _clean(body):
    data = {}
    for field in ADDRESS_FIELDS:
        if field not in body:
            continue
        value = body.get(field)
        if value is None:
            value = ""
        value = str(value).strip()
        if field == "country" and len(value) == 2:
            value = value.upper()
        data[field] = value
    return data


@router.get("")
def list_addresses(user: dict = Depends(require_user)):
    rows = db.all(
        "SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC",
        (user["id"],),
    )
    return {"addresses": [_normalize(row) for row in rows]}


@router.get("/{address_id}")
def get_address(address_id: str, user: dict = Depends(require_user)):
    address = _owned(address_id, user["id"])
    if not address:
        raise HTTPException(status_code=404, detail={"error": "Address not found"})
    return {"address": _normalize(address)}


@router.post("", status_code=201)
def create_address(body: dict = Body(...), user: dict = Depends(require_user)):
    _validate(body)

    count = db.get("SELECT COUNT(*) AS count FROM addresses WHERE user_id = ?", (user["id"],))["count"]
    if count >= MAX_ADDRESSES:
        raise HTTPException(
            status_code=400,
            detail={"error": f"Maximum of {MAX_ADDRESSES} addresses reached"},
        )

    data = _clean(body)
    is_default = bool(body.get("is_default")) or count == 0
    address_id = str(uuid.uuid4())

    db.run(
        """
        INSERT INTO addresses
          (id, user_id, label, full_name, phone, line1, line2, city, region,
           postal_code, country, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            address_id,
            user["id"],
            data.get("label") or "Home",
            data.get("full_name", ""),
            data.get("phone", ""),
            data.get("line1", ""),
            data.get("line2", ""),
            data.get("city", ""),
            data.get("region", ""),
            data.get("postal_code", ""),
            data.get("country") or "NG",
            1 if is_default else 0,
        ),
    )
    if is_default:
        db.run(
            "UPDATE addresses SET is_default = 0 WHERE user_id = ? AND id != ?",
            (user["id"], address_id),
        )
    return {"address": _normalize(_owned(address_id, user["id"]))}


@router.put("/{address_id}")
def update_address(
    address_id: str, body: dict = Body(...), user: dict = Depends(require_user)
):
    existing = _owned(address_id, user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Address not found"})

    _validate(body, partial=True)
    data = _clean(body)

    if bool(body.get("is_default")):
        db.run("UPDATE addresses SET is_default = 0 WHERE user_id = ?", (user["id"],))

    assignments = []
    params = []
    for field in ADDRESS_FIELDS:
        if field in data:
            assignments.append(f"{field} = ?")
            params.append(data[field])
    if bool(body.get("is_default")):
        assignments.append("is_default = 1")
    if assignments:
        assignments.append("updated_at = datetime('now')")
        params.extend([address_id, user["id"]])
        db.run(
            f"UPDATE addresses SET {', '.join(assignments)} WHERE id = ? AND user_id = ?",
            tuple(params),
        )

    return {"address": _normalize(_owned(address_id, user["id"]))}


@router.post("/{address_id}/default")
def set_default_address(address_id: str, user: dict = Depends(require_user)):
    existing = _owned(address_id, user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Address not found"})

    db.run("UPDATE addresses SET is_default = 0 WHERE user_id = ?", (user["id"],))
    db.run(
        "UPDATE addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        (address_id, user["id"]),
    )
    return {"address": _normalize(_owned(address_id, user["id"]))}


@router.delete("/{address_id}")
def delete_address(address_id: str, user: dict = Depends(require_user)):
    existing = _owned(address_id, user["id"])
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Address not found"})

    db.run("DELETE FROM addresses WHERE id = ? AND user_id = ?", (address_id, user["id"]))
    if existing["is_default"]:
        nxt = db.get(
            "SELECT id FROM addresses WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT 1",
            (user["id"],),
        )
        if nxt:
            db.run(
                "UPDATE addresses SET is_default = 1, updated_at = datetime('now') WHERE id = ?",
                (nxt["id"],),
            )
    return {"success": True}
