import re
import unicodedata

OFF_PLATFORM_MESSAGE = (
    "Keep the deal on TradeHub: phone numbers, WhatsApp links and social handles "
    "are not allowed in listings or pre-purchase messages."
)

_DASHES = str.maketrans({
    "\u2010": "-",
    "\u2011": "-",
    "\u2012": "-",
    "\u2013": "-",
    "\u2014": "-",
    "\u2015": "-",
    "\u2212": "-",
    "\u00a0": " ",
})

_PATTERNS = (
    ("phone number", re.compile(r"(?<!\w)(?:\+|00)\d[\d\s().-]{6,18}\d(?!\w)")),
    ("phone number", re.compile(r"(?<!\d)0[78901]\d{9}(?!\d)")),
    ("phone number", re.compile(r"(?<!\d)\d{3}[\s.-]\d{3}[\s.-]\d{4}(?!\d)")),
    ("phone number", re.compile(r"(?<!\d)\d{4}[\s.-]\d{3}[\s.-]\d{3}(?!\d)")),
    (
        "WhatsApp link",
        re.compile(
            r"(?i)\b(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|web\.whatsapp\.com|whatsapp\.com)\b"
        ),
    ),
    ("WhatsApp link", re.compile(r"(?i)\b(?:whatsapp|whats\s*app)\b")),
    ("social handle", re.compile(r"(?<![\w.@])@[A-Za-z0-9_][A-Za-z0-9_.]{1,29}\b")),
    (
        "social handle",
        re.compile(
            r"(?i)\b(?:instagram|facebook|twitter|tiktok|snapchat|telegram|discord|messenger|wechat|viber|linkedin)"
            r"\s*(?:@|:)\s*[A-Za-z0-9._]{2,30}\b"
        ),
    ),
    ("social handle", re.compile(r"(?i)\b(?:dm|direct message|message|follow|add|find)\s+me\b")),
    (
        "social link",
        re.compile(
            r"(?i)(?<![\w.])(?:instagram|facebook|twitter|x|tiktok|snapchat|telegram|discord|linkedin|youtube)"
            r"\.(?:com|net|me|tv|co)\b"
        ),
    ),
)


def find_offplatform_contact(value):
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = unicodedata.normalize("NFKC", value).translate(_DASHES)
    for kind, pattern in _PATTERNS:
        match = pattern.search(normalized)
        if match:
            return {"type": kind, "match": match.group(0).strip(), "message": OFF_PLATFORM_MESSAGE}
    return None


def has_offplatform_contact(value):
    return find_offplatform_contact(value) is not None
