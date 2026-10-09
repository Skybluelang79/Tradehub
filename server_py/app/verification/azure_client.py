import logging
import time

import httpx

from .. import config

logger = logging.getLogger("tradehub")

DI_API_VERSION = "2023-07-31"
DI_MODEL = "prebuilt-idDocument"
FACE_API_VERSION = "face/v1.0"


class AzureError(Exception):
    def __init__(self, message, status=None, service="azure"):
        super().__init__(message)
        self.status = status
        self.service = service


def is_document_intelligence_configured():
    return bool(config.AZURE_DOC_INTELLIGENCE_ENDPOINT and config.AZURE_DOC_INTELLIGENCE_KEY)


def is_face_configured():
    return bool(config.AZURE_FACE_ENDPOINT and config.AZURE_FACE_KEY)


_client = None


def _http():
    global _client
    if _client is None:
        _client = httpx.Client(timeout=60.0)
    return _client


def _headers(key):
    return {"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json"}


# --- Azure AI Document Intelligence: prebuilt ID-document extraction ----------


def _field(fields, name):
    return fields.get(name) if isinstance(fields, dict) else None


def analyze_id_document(image_bytes):
    """Extract structured ID fields from a document photo.

    Returns the analyzeResult dict (documents, content) from Document
    Intelligence. Throws AzureError on any failure so callers can decide
    whether to degrade to manual review.
    """
    if not is_document_intelligence_configured():
        raise AzureError("Azure Document Intelligence is not configured", 503, "documentintelligence")

    url = (
        f"{config.AZURE_DOC_INTELLIGENCE_ENDPOINT.rstrip('/')}/documentintelligence/"
        f"documentModels/{DI_MODEL}:analyze?api-version={DI_API_VERSION}"
    )
    try:
        res = _http().post(
            url,
            files={"file": ("document.png", image_bytes, "application/octet-stream")},
            headers={"Ocp-Apim-Subscription-Key": config.AZURE_DOC_INTELLIGENCE_KEY},
        )
        res.raise_for_status()
        operation_location = res.headers.get("operation-location")
        if not operation_location:
            raise AzureError("Document Intelligence analyze returned no operation-location", 502, "documentintelligence")

        for _ in range(30):
            poll = _http().get(
                operation_location,
                headers={"Ocp-Apim-Subscription-Key": config.AZURE_DOC_INTELLIGENCE_KEY},
            )
            poll.raise_for_status()
            state = poll.json()
            status = state.get("status")
            if status == "succeeded":
                return state.get("analyzeResult") or {}
            if status == "failed":
                raise AzureError("Document Intelligence analysis failed", 502, "documentintelligence")
            if status not in ("running", "notStarted"):
                raise AzureError(f"Document Intelligence analysis status: {status}", 502, "documentintelligence")
            time.sleep(1)
        raise AzureError("Document Intelligence analysis timed out", 504, "documentintelligence")
    except AzureError:
        raise
    except httpx.HTTPStatusError as err:
        raise AzureError(f"Document Intelligence HTTP {err.response.status_code}", err.response.status_code, "documentintelligence")
    except httpx.HTTPError as err:
        raise AzureError(f"Document Intelligence request failed: {err}", 502, "documentintelligence")


def summarize_id_fields(result):
    """Flatten the analyzeResult into a compact, client-friendly dict.

    Returns a dict with the fields the verification checks consume:
    docType, documentNumber (value + confidence), firstName, lastName,
    dateOfBirth, dateOfExpiration, country, nationality, sex, mrz, content,
    and the overall document confidence.
    """
    summary = {
        "docType": None,
        "docTypeConfidence": None,
        "documentNumber": None,
        "documentNumberConfidence": None,
        "firstName": None,
        "lastName": None,
        "dateOfBirth": None,
        "dateOfExpiration": None,
        "country": None,
        "nationality": None,
        "sex": None,
        "mrz": "",
        "content": result.get("content") or "",
        "confidence": None,
    }
    docs = result.get("documents") or []
    if not docs:
        return summary
    doc = docs[0]
    fields = doc.get("fields") or {}
    summary["docType"] = doc.get("docType")
    summary["docTypeConfidence"] = doc.get("confidence")
    summary["confidence"] = doc.get("confidence")

    string_field = _field(fields, "DocumentNumber")
    if string_field:
        summary["documentNumber"] = string_field.get("valueString") or string_field.get("content")
        summary["documentNumberConfidence"] = string_field.get("confidence")

    def grab(name, key, date_only=False):
        f = _field(fields, name)
        if not f:
            return
        value = f.get("valueDate") if date_only else (f.get("valueString") or f.get("content"))
        if value is not None and summary[key] is None:
            summary[key] = value

    grab("FirstName", "firstName")
    grab("LastName", "lastName")
    grab("DateOfBirth", "dateOfBirth", date_only=True)
    grab("DateOfExpiration", "dateOfExpiration", date_only=True)
    grab("CountryRegion", "country")
    grab("Nationality", "nationality")
    grab("Sex", "sex")

    mrz = _field(fields, "MachineReadableZone")
    if mrz:
        summary["mrz"] = mrz.get("content") or ""
    return summary


# --- Azure AI Face: portrait match between selfie and document photo ----------


def detect_face(image_bytes):
    if not is_face_configured():
        raise AzureError("Azure Face is not configured", 503, "face")
    url = (
        f"{config.AZURE_FACE_ENDPOINT.rstrip('/')}/{FACE_API_VERSION}/detect"
        "?returnFaceId=true&recognitionModel=recognition_04&detectionModel=detection_03"
    )
    try:
        res = _http().post(
            url,
            content=image_bytes,
            headers={
                "Ocp-Apim-Subscription-Key": config.AZURE_FACE_KEY,
                "Content-Type": "application/octet-stream",
            },
        )
        res.raise_for_status()
        return res.json()
    except httpx.HTTPStatusError as err:
        raise AzureError(f"Face detect HTTP {err.response.status_code}", err.response.status_code, "face")
    except httpx.HTTPError as err:
        raise AzureError(f"Face detect request failed: {err}", 502, "face")


def verify_faces(face_id1, face_id2):
    if not is_face_configured():
        raise AzureError("Azure Face is not configured", 503, "face")
    url = f"{config.AZURE_FACE_ENDPOINT.rstrip('/')}/{FACE_API_VERSION}/verify"
    try:
        res = _http().post(
            url,
            json={"faceId1": face_id1, "faceId2": face_id2},
            headers=_headers(config.AZURE_FACE_KEY),
        )
        res.raise_for_status()
        return res.json()
    except httpx.HTTPStatusError as err:
        raise AzureError(f"Face verify HTTP {err.response.status_code}", err.response.status_code, "face")
    except httpx.HTTPError as err:
        raise AzureError(f"Face verify request failed: {err}", 502, "face")


def compare_faces(id_image_bytes, selfie_bytes):
    """Verify the selfie and the document portrait are the same person.

    Returns {"isSameFace": bool, "confidence": float | None} and raises
    AzureError when either image has zero or more than one face.
    """
    id_faces = detect_face(id_image_bytes)
    selfie_faces = detect_face(selfie_bytes)
    if len(id_faces) != 1:
        raise AzureError("Expected exactly one face on the document photo", 422, "face")
    if len(selfie_faces) != 1:
        raise AzureError("Expected exactly one face in the selfie", 422, "face")
    result = verify_faces(id_faces[0]["faceId"], selfie_faces[0]["faceId"])
    return {
        "isSameFace": bool(result.get("isIdentical")),
        "confidence": result.get("confidence"),
    }