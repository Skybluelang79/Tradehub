import re

from .. import db

# The document kinds the app accepts (matches server/routes/verification.js).
ID_TYPES = ["national_id", "passport", "drivers_license", "residence_permit", "other"]

# Document Intelligence's prebuilt-idDocument reports a docType on the doc;
# map each app id_type to the docTypes we will accept for it.
DOC_TYPE_MAP = {
    "national_id": {"nationalidentitycard", "idcard", "identitycard", "other"},
    "passport": {"passport"},
    "drivers_license": {"driverlicense", "license", "other"},
    "residence_permit": {"residencepermit", "permit"},
    "other": None,  # any detected docType is acceptable
}

# Optional aliases matched case-insensitively before normalizing spaces.
_DOC_TYPE_ALIASES = {
    "national_id": {"national-id", "national id", "nin"},
    "drivers_license": {"driver-s-license", "drivers license", "driver's license", "driver license"},
    "passport": {"international passport"},
    "residence_permit": {"residence permit"},
}


def normalize_id_number(value):
    if value is None:
        return ""
    return re.sub(r"[^A-Z0-9]", "", str(value).upper())


def detected_doc_type_matches(id_type, detected):
    """True when the OCR'd document type is plausible for the submitted id_type."""
    expected = DOC_TYPE_MAP.get(id_type)
    if expected is None:
        return True
    if not detected:
        return False
    normalized = re.sub(r"[^a-z]", "", str(detected).lower())
    return normalized in expected


def number_matches(submitted, extracted_values):
    """True when the submitted ID number matches any OCR-extracted candidate.

    extracted_values may contain the DocumentNumber field value, MRZ text and
    raw content; each candidate is normalized on the same rules the submitted
    value goes through so spacing/casing never masks a true match.
    """
    wanted = normalize_id_number(submitted)
    if not wanted:
        return False
    for candidate in extracted_values:
        candidate = normalize_id_number(candidate)
        if candidate and candidate == wanted:
            return True
        if len(wanted) >= 6 and wanted in candidate:
            return True
    return False


def duplicate_id_number(id_number, exclude_user_id):
    """True when the same (normalized) ID number already belongs to another
    account that has an approved or pending verification request."""
    needle = normalize_id_number(id_number)
    if not needle:
        return False
    rows = db.all(
        """
        SELECT user_id, id_number FROM verification_requests
        WHERE status IN ('approved', 'pending')
        """
    )
    for row in rows:
        if row["user_id"] == exclude_user_id:
            continue
        if normalize_id_number(row["id_number"]) == needle:
            return True
    return False


def id_number_in_content(submitted, content):
    """Fallback: locate the submitted number verbatim inside the full OCR text."""
    wanted = normalize_id_number(submitted)
    if not wanted or not content:
        return False
    return wanted in re.sub(r"[^A-Z0-9]", "", str(content).upper())