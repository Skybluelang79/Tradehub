"""Lightweight image + receipt vision helpers.

No heavy ML dependencies: image statistics come from Pillow, and receipt OCR
uses Azure AI Document Intelligence (``prebuilt-receipt``) when configured,
degrading cleanly when it is not. Receipt field parsing is pure regex so it
works offline for tests.
"""

import io
import logging
import re
from collections import Counter

import httpx

from . import config

logger = logging.getLogger("tradehub")

try:
    from PIL import Image
except Exception:  # pragma: no cover - Pillow is a declared dependency
    Image = None

DI_API_VERSION = "2023-07-31"
DI_RECEIPT_MODEL = "prebuilt-receipt"

COLOR_NAMES = [
    ("black", (0, 0, 0)),
    ("white", (255, 255, 255)),
    ("gray", (128, 128, 128)),
    ("red", (220, 50, 50)),
    ("orange", (240, 150, 40)),
    ("yellow", (240, 220, 60)),
    ("green", (60, 170, 80)),
    ("teal", (40, 170, 170)),
    ("blue", (60, 100, 220)),
    ("purple", (140, 80, 200)),
    ("pink", (230, 130, 180)),
    ("brown", (140, 100, 60)),
]

CURRENCY_SYMBOLS = {
    "\u20a6": "NGN",
    "$": "USD",
    "\u20ac": "EUR",
    "\u00a3": "GBP",
    "\u20b9": "INR",
    "R$": "BRL",
    "GH\u20b5": "GHS",
    "KSh": "KES",
    "ZAR": "ZAR",
}

CURRENCY_CODES = ("NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "INR", "CAD", "AUD")

DATE_PATTERNS = [
    re.compile(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b"),
    re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b"),
    re.compile(
        r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})\b",
        re.IGNORECASE,
    ),
]

AMOUNT_LINE_RE = re.compile(
    r"(?i)(total|grand\s*total|amount\s*due|total\s*due|balance\s*due|amount|sum)\D{0,12}?"
    r"([\u20a6$\u20ac\u00a3\u20b9]?)\s*([\d][\d,]*(?:\.\d{1,2})?)"
)
AMOUNT_ANY_RE = re.compile(r"([\u20a6$\u20ac\u00a3\u20b9]?)\s*([\d][\d,]*(?:\.\d{1,2})?)")

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def is_available():
    return Image is not None


def is_receipt_ocr_configured():
    return bool(config.AZURE_DOC_INTELLIGENCE_ENDPOINT and config.AZURE_DOC_INTELLIGENCE_KEY)


# --- image analysis ---------------------------------------------------------


def _to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, int(c))) for c in rgb))


def _dominant_color(pixels):
    buckets = Counter()
    sums = {}
    for r, g, b in pixels:
        key = (r // 32, g // 32, b // 32)
        buckets[key] += 1
        acc = sums.setdefault(key, [0, 0, 0])
        acc[0] += r
        acc[1] += g
        acc[2] += b
    key, count = buckets.most_common(1)[0]
    acc = sums[key]
    return tuple(c // count for c in acc)


def _nearest_color_name(rgb):
    best = None
    best_dist = None
    for name, ref in COLOR_NAMES:
        dist = sum((rgb[i] - ref[i]) ** 2 for i in range(3))
        if best_dist is None or dist < best_dist:
            best, best_dist = name, dist
    return best


def _load(data):
    if Image is None:
        raise RuntimeError("Pillow is not installed")
    return Image.open(io.BytesIO(data))


def analyze_image(data):
    """Return basic, non-ML statistics about an image."""
    with _load(data) as img:
        img.load()
        width, height = img.size
        fmt = img.format or ""
        mode = img.mode
        small = img.convert("RGB").resize((64, 64))
        pixels = list(small.getdata())

    count = len(pixels)
    avg = tuple(sum(p[i] for p in pixels) // count for i in range(3))
    dominant = _dominant_color(pixels)
    brightness = round((0.299 * avg[0] + 0.587 * avg[1] + 0.114 * avg[2]) / 255, 4)

    if width > height:
        orientation = "landscape"
    elif height > width:
        orientation = "portrait"
    else:
        orientation = "square"

    return {
        "width": width,
        "height": height,
        "format": fmt,
        "mode": mode,
        "aspectRatio": round(width / height, 4) if height else None,
        "orientation": orientation,
        "averageColor": _to_hex(avg),
        "dominantColor": _to_hex(dominant),
        "dominantColorName": _nearest_color_name(dominant),
        "brightness": brightness,
    }


def describe_image(data):
    """Produce a short text hint suitable for AI listing generation."""
    info = analyze_image(data)
    return (
        f"{info['orientation']} {info['format']} image "
        f"({info['width']}x{info['height']}), predominantly {info['dominantColorName']}, "
        f"{'bright' if info['brightness'] >= 0.6 else 'dark' if info['brightness'] <= 0.35 else 'balanced'} lighting"
    )


# --- receipt OCR (Azure Document Intelligence, optional) --------------------


def _ocr_receipt(data):
    if not is_receipt_ocr_configured():
        return None
    url = (
        f"{config.AZURE_DOC_INTELLIGENCE_ENDPOINT.rstrip('/')}/documentintelligence/"
        f"documentModels/{DI_RECEIPT_MODEL}:analyze?api-version={DI_API_VERSION}"
    )
    headers = {"Ocp-Apim-Subscription-Key": config.AZURE_DOC_INTELLIGENCE_KEY}
    try:
        res = httpx.post(
            url,
            files={"file": ("receipt.png", data, "application/octet-stream")},
            headers=headers,
            timeout=60.0,
        )
        res.raise_for_status()
        operation_location = res.headers.get("operation-location")
        if not operation_location:
            return None
        for _ in range(30):
            poll = httpx.get(operation_location, headers=headers, timeout=30.0)
            poll.raise_for_status()
            state = poll.json()
            status = state.get("status")
            if status == "succeeded":
                result = state.get("analyzeResult") or {}
                return result.get("content") or ""
            if status == "failed":
                logger.warning("Receipt OCR analysis failed")
                return None
            import time

            time.sleep(1)
        logger.warning("Receipt OCR analysis timed out")
        return None
    except httpx.HTTPError as exc:
        logger.warning("Receipt OCR request failed: %s", exc)
        return None


def _normalize_amount(raw):
    try:
        return float(raw.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def _detect_currency(symbol, text):
    if symbol and symbol in CURRENCY_SYMBOLS:
        return CURRENCY_SYMBOLS[symbol]
    upper = (text or "").upper()
    for code in CURRENCY_CODES:
        if re.search(rf"\b{code}\b", upper):
            return code
    return None


def _detect_date(text):
    for pattern in DATE_PATTERNS:
        m = pattern.search(text)
        if not m:
            continue
        if pattern is DATE_PATTERNS[2]:
            month = MONTHS.get(m.group(1).lower()[:3])
            day = int(m.group(2))
            year = int(m.group(3))
            if len(m.group(3)) == 2:
                year += 2000
            if month:
                return f"{year:04d}-{month:02d}-{day:02d}"
        else:
            a, b, c = m.group(1), m.group(2), m.group(3)
            if len(a) == 4:
                return f"{int(a):04d}-{int(b):02d}-{int(c):02d}"
            year = int(c)
            if len(c) == 2:
                year += 2000
            return f"{year:04d}-{int(b):02d}-{int(a):02d}"
    return None


def _detect_merchant(text):
    for line in (text or "").splitlines():
        stripped = line.strip()
        if stripped and not re.match(r"^[\d\W]+$", stripped):
            return stripped[:80]
    return None


def parse_receipt(text):
    """Extract a few common fields from raw receipt text (offline, regex)."""
    text = text or ""
    amount = None
    matched_amount = AMOUNT_LINE_RE.search(text)
    if matched_amount:
        amount = _normalize_amount(matched_amount.group(3))
        currency = _detect_currency(matched_amount.group(2), text)
    else:
        currency = _detect_currency(None, text)
        candidates = [m for m in AMOUNT_ANY_RE.finditer(text)]
        if candidates:
            amount = _normalize_amount(candidates[-1].group(2))

    return {
        "amount": amount,
        "currency": currency,
        "date": _detect_date(text),
        "merchant": _detect_merchant(text),
    }


def read_receipt(data):
    """OCR a receipt image and parse its fields.

    Returns ``{"receipt": {...}, "text": "..."}``. Raises ``RuntimeError`` when
    receipt OCR is not configured so callers can map it to a 503.
    """
    if not is_receipt_ocr_configured():
        raise RuntimeError("Receipt OCR is not configured")
    text = _ocr_receipt(data) or ""
    return {"receipt": parse_receipt(text), "text": text}
