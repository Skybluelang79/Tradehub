import re

USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]+$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^[+0-9][0-9\s\-().]{5,23}$")


def username_error(username):
    if len(username) < 3:
        return "Username must be at least 3 characters"
    if len(username) > 30:
        return "Username must be at most 30 characters"
    if not USERNAME_RE.match(username):
        return "Username can only contain letters, numbers, and underscores"
    return None


def raise_validation(details):
    from fastapi import HTTPException

    raise HTTPException(status_code=400, detail={"error": "Validation failed", "details": details})