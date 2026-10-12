import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from .. import config
from ..deps import require_user

router = APIRouter()

UPLOADS_DIR = config.UPLOADS_DIR

try:
    os.makedirs(UPLOADS_DIR, exist_ok=True)
except OSError:
    pass

IMAGE_EXTS = {".jpeg", ".jpg", ".png", ".gif", ".webp"}
IMAGE_MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

IMAGE_TYPES = ["jpeg", "jpg", "png", "gif", "webp", "bmp", "svg"]
DOC_TYPES = ["pdf", "doc", "docx", "xls", "xlsx", "csv", "txt", "rtf", "ppt", "pptx", "odt"]
ARCHIVE_TYPES = ["zip", "rar", "7z", "tar", "gz"]
AUDIO_TYPES = ["mp3", "m4a", "wav", "ogg", "aac", "opus", "webm"]
VIDEO_TYPES = ["mp4", "mov", "avi", "mkv", "webm"]

IMAGE_MAX = 5 * 1024 * 1024
ATTACHMENT_MAX = 20 * 1024 * 1024


def _ext(original_name):
    return os.path.splitext(original_name or "")[1]


def _ext_no_dot(original_name):
    return _ext(original_name).lower().replace(".", "")


def _mime(file):
    return str(file.content_type or "")


async def _read_limited(file, limit):
    chunks = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(status_code=400, detail={"error": "File too large. Maximum size is 5MB."})
        chunks.append(chunk)
    return b"".join(chunks)


def _save(data, ext):
    filename = f"{uuid.uuid4()}{ext}"
    with open(os.path.join(UPLOADS_DIR, filename), "wb") as fh:
        fh.write(data)
    return filename


def _attachment_kind(file):
    mime = _mime(file)
    if mime.startswith("image/"):
        return "image"
    if mime.startswith("video/"):
        return "video"
    if mime.startswith("audio/"):
        return "audio"
    return "document"


def _validate_image(file):
    ext_ok = _ext(file.filename).lower() in IMAGE_EXTS
    mime_ok = _mime(file).lower() in IMAGE_MIMES
    if not (ext_ok and mime_ok):
        raise HTTPException(status_code=400, detail={"error": "Only image files are allowed"})


def _validate_attachment(file):
    ext = _ext_no_dot(file.filename)
    mime = _mime(file)
    allowed = IMAGE_TYPES + DOC_TYPES + ARCHIVE_TYPES + AUDIO_TYPES + VIDEO_TYPES
    family_matches = (
        (mime.startswith("image/") and ext in IMAGE_TYPES)
        or (mime.startswith("audio/") and ext in AUDIO_TYPES)
        or (mime.startswith("video/") and ext in VIDEO_TYPES)
        or ((mime.startswith("application/") or mime.startswith("text/"))
            and (ext in DOC_TYPES or ext in ARCHIVE_TYPES))
    )
    if ext not in allowed or not family_matches:
        raise HTTPException(status_code=400, detail={"error": "File type not supported for chat attachments"})


@router.post("")
async def upload_images(
    images: list[UploadFile] = File(default=[]),
    user: dict = Depends(require_user),
):
    if len(images) > 6:
        raise HTTPException(status_code=400, detail={"error": "Unexpected field"})
    files = []
    for f in images:
        _validate_image(f)
        ext = _ext(f.filename)
        data = await _read_limited(f, IMAGE_MAX)
        stored = _save(data, ext)
        files.append({"url": f"/uploads/{stored}", "filename": stored})
    return {"files": files}


@router.post("/single")
async def upload_single(
    image: UploadFile | None = File(default=None),
    user: dict = Depends(require_user),
):
    if image is None or not image.filename:
        raise HTTPException(status_code=400, detail={"error": "No file uploaded"})
    _validate_image(image)
    ext = _ext(image.filename)
    data = await _read_limited(image, IMAGE_MAX)
    stored = _save(data, ext)
    return {"file": {"url": f"/uploads/{stored}", "filename": image.filename}}


@router.post("/attachment")
async def upload_attachment(
    file: UploadFile | None = File(default=None),
    user: dict = Depends(require_user),
):
    if file is None or not file.filename:
        raise HTTPException(status_code=400, detail={"error": "No file uploaded"})
    _validate_attachment(file)
    data = await _read_limited(file, ATTACHMENT_MAX)
    stored = _save(data, _ext(file.filename))
    return {
        "file": {
            "url": f"/uploads/{stored}",
            "filename": file.filename or "file",
            "kind": _attachment_kind(file),
            "mime": _mime(file) or _ext(file.filename).replace(".", ""),
            "size": len(data),
        }
    }
