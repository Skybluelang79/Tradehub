import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from .. import vision
from ..deps import require_user

logger = logging.getLogger("tradehub")

router = APIRouter()

MAX_IMAGE_BYTES = 10 * 1024 * 1024


async def _read_image(image: UploadFile):
    if image is None or not image.filename:
        raise HTTPException(status_code=400, detail={"error": "No image uploaded"})
    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail={"error": "No image uploaded"})
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail={"error": "Image too large. Maximum size is 10MB."})
    return data


@router.get("/status")
def vision_status():
    return {
        "imageAnalysis": vision.is_available(),
        "receiptOcr": vision.is_receipt_ocr_configured(),
    }


@router.post("/analyze")
async def analyze(image: UploadFile = File(...), user: dict = Depends(require_user)):
    data = await _read_image(image)
    try:
        return {"analysis": vision.analyze_image(data)}
    except Exception as exc:
        logger.warning("Image analysis failed: %s", exc)
        raise HTTPException(status_code=400, detail={"error": "Unsupported or corrupt image"})


@router.post("/describe")
async def describe(image: UploadFile = File(...), user: dict = Depends(require_user)):
    data = await _read_image(image)
    try:
        return {"hints": vision.describe_image(data)}
    except Exception as exc:
        logger.warning("Image describe failed: %s", exc)
        raise HTTPException(status_code=400, detail={"error": "Unsupported or corrupt image"})


@router.post("/receipt")
async def receipt(image: UploadFile = File(...), user: dict = Depends(require_user)):
    data = await _read_image(image)
    try:
        return vision.read_receipt(data)
    except RuntimeError:
        raise HTTPException(status_code=503, detail={"error": "Receipt OCR is not configured"})
