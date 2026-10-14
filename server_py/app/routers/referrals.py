import logging
import random
import re

from fastapi import APIRouter, Depends

from .. import db
from ..deps import require_user

logger = logging.getLogger("tradehub")

router = APIRouter()

REWARD_CENTS = 100000


def _sanitize_code(code):
    return re.sub(r"[^A-Z0-9]", "", str(code or "").strip().upper())


def _random_suffix():
    return "".join(random.choices("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", k=3))


def generate_referral_code(user_id, name):
    base = _sanitize_code((str(name or "").split() or [""])[0] or "USER")[:8] or "USER"
    code = f"{base}{_random_suffix()}"[:12]
    attempts = 0
    while db.get("SELECT id FROM users WHERE referral_code = ?", (code,)) and attempts < 5:
        code = f"{base}{_random_suffix()}"[:12]
        attempts += 1
    return code


def ensure_referral_code(user_id, name=None):
    if not user_id:
        return ""
    user = db.get("SELECT referral_code, name FROM users WHERE id = ?", (user_id,))
    if not user:
        return ""
    if user["referral_code"]:
        return user["referral_code"]
    code = generate_referral_code(user_id, user["name"] or name or "USER")
    db.run("UPDATE users SET referral_code = ? WHERE id = ?", (code, user_id))
    return code


@router.get("/my")
def my_referrals(user: dict = Depends(require_user)):
    code = ensure_referral_code(user["id"])
    referred = db.get(
        "SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?", (user["id"],)
    )["c"]
    credited = db.get(
        "SELECT COALESCE(SUM(reward_cents), 0) as c FROM referrals WHERE referrer_id = ? AND status = 'credited'",
        (user["id"],),
    )["c"]
    rows = db.all(
        """
        SELECT r.code, r.reward_cents, r.status, r.created_at,
               u.name AS referred_name, u.avatar AS referred_avatar
        FROM referrals r LEFT JOIN users u ON u.id = r.referred_id
        WHERE r.referrer_id = ? ORDER BY r.created_at DESC
        """,
        (user["id"],),
    )
    return {
        "code": code,
        "rewardCents": REWARD_CENTS,
        "referredCount": referred,
        "earnedCents": credited,
        "list": rows,
    }


@router.post("/code")
def referral_code(user: dict = Depends(require_user)):
    return {"code": ensure_referral_code(user["id"])}
