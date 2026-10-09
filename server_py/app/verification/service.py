import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from .. import config
from . import azure_client, checks
from .azure_client import analyze_id_document, compare_faces
from .azure_client import is_document_intelligence_configured, is_face_configured

logger = logging.getLogger("tradehub")

# Minimum portrait-match confidence (0.45+ means same person per Azure docs).
PORTRAIT_MIN_CONFIDENCE = float(config.VERIFY_AUTO_APPROVE_MIN_CONFIDENCE)
FACE_MIN_CONFIDENCE = max(PORTRAIT_MIN_CONFIDENCE - 0.35, 0.5)


@dataclass
class VerificationResult:
    decision: str = "pending"  # approved | pending | skipped
    extracted: dict = field(default_factory=dict)
    checks: dict = field(default_factory=dict)
    notes: list = field(default_factory=list)

    def as_dict(self):
        return {
            "decision": self.decision,
            "extracted": self.extracted,
            "checks": self.checks,
            "notes": self.notes,
        }


def _upload_path(image_url):
    if not image_url:
        return None
    name = image_url.strip().lstrip("/").replace("\\", "/")
    if name.startswith("uploads/"):
        name = name[len("uploads/"):]
    candidates = [Path(config.UPLOADS_DIR) / name]
    if config.UPLOADS_DIR and not (Path(config.UPLOADS_DIR) / name).exists():
        candidates.append(Path(config.UPLOADS_DIR).parent / "server" / "uploads" / name)
    for path in candidates:
        if path.exists():
            return path
    return None


def _read_bytes(image_url):
    path = _upload_path(image_url)
    if path is None:
        raise FileNotFoundError(f"No local file found for {image_url}")
    return path.read_bytes()


# Run the full automated verification pipeline for a submitted request.
def run_verification(id_type, id_number, id_image_url, selfie_url=None, user_id=None, include_face=True):
    result = VerificationResult()
    result.checks = {
        "doc_type": {"pass": False, "required": True, "note": "No document type detected"},
        "number": {"pass": False, "required": True, "note": "No ID number extracted"},
        "duplicate": {"pass": True, "required": True, "note": "No duplicate detected"},
        "portrait": {"pass": None, "required": False, "note": "No selfie — portrait check skipped"},
    }

    if not is_document_intelligence_configured():
        result.decision = "skipped"
        result.notes.append("AI verification is not configured; request queued for manual review.")
        return result

    try:
        id_bytes = _read_bytes(id_image_url)
    except FileNotFoundError as err:
        result.decision = "pending"
        result.notes.append(str(err))
        logger.warning("Verification engine could not read upload: %s", err)
        return result

    try:
        analyze_result = analyze_id_document(id_bytes)
        summary = azure_client.summarize_id_fields(analyze_result)
    except Exception as err:
        result.decision = "pending"
        result.notes.append(f"Document extraction failed: {err}")
        logger.warning("Verification document extraction failed: %s", err)
        return result

    result.extracted = summary
    confidence = min(
        [c for c in [summary["documentNumberConfidence"], summary["docTypeConfidence"]] if c is not None] or [0.0]
    )

    detected_type = summary["docType"]
    result.checks["doc_type"] = {
        "pass": checks.detected_doc_type_matches(id_type, detected_type),
        "detected": detected_type,
        "required": True,
        "note": f"Document type detected as {detected_type or 'unknown'}",
    }

    candidates = []
    if summary["documentNumber"]:
        candidates.append(summary["documentNumber"])
    if summary["mrz"]:
        candidates.append(summary["mrz"])
    number_ok = checks.number_matches(id_number, candidates) or (
        summary["documentNumber"] is None and checks.id_number_in_content(id_number, summary["content"])
    )
    result.checks["number"] = {
        "pass": number_ok,
        "required": True,
        "note": "Extracted number matches the submitted ID number"
        if number_ok and summary["documentNumber"]
        else "Number matched via full OCR text"
        if number_ok
        else "Extracted number does not match submission",
    }

    if summary["documentNumber"] is None:
        result.checks["number"]["note"] = "No number extracted by OCR"

    if user_id:
        result.checks["duplicate"] = {
            "pass": not checks.duplicate_id_number(id_number, user_id),
            "required": True,
            "note": "Same ID number was not used by another account",
        }

    if selfie_url and include_face:
        if not is_face_configured():
            result.checks["portrait"] = {
                "pass": None,
                "required": True,
                "note": "Selfie submitted but Face verification is not configured",
            }
            result.checks["portrait"]["required"] = True
        else:
            try:
                selfie_bytes = _read_bytes(selfie_url)
                match = compare_faces(id_bytes, selfie_bytes)
                pass_value = bool(match["isSameFace"]) and (match["confidence"] or 0) >= FACE_MIN_CONFIDENCE
                result.checks["portrait"] = {
                    "pass": pass_value,
                    "required": True,
                    "note": f"Portrait match confidence {match['confidence']:.2f}" if match["confidence"] else "No face found on one image",
                }
            except Exception as err:
                result.checks["portrait"] = {
                    "pass": False,
                    "required": True,
                    "note": f"Portrait comparison failed: {err}",
                }

    failed_required = any(
        check.get("required") and check.get("pass") is not True for check in result.checks.values()
    )

    if failed_required:
        result.decision = "pending"
        result.notes.append("One or more required checks failed; queued for manual review.")
    elif confidence >= PORTRAIT_MIN_CONFIDENCE and summary["documentNumber"]:
        result.decision = "approved"
        result.notes.append("Automated verification passed; seller identity approved automatically.")
    else:
        result.decision = "pending"
        result.notes.append("Confidence below the auto-approve threshold; queued for manual review.")

    return result


def approval_summary(result):
    if not result.decision:
        return {}
    return {k: v for k, v in result.as_dict().items() if k != "checks"} | {"checks": result.checks}