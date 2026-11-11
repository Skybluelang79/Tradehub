import re
import uuid

from . import db, notifications

REWARD_CENTS = 100000


def _sanitize_code(code):
    return re.sub(r"[^A-Z0-9]", "", str(code or "").strip().upper())


def apply_referral(referred_id, raw_code):
    """Attach a new signup to the referrer whose code they used."""
    code = _sanitize_code(raw_code)
    if not code or not referred_id:
        return False

    referrer = db.get("SELECT id FROM users WHERE referral_code = ?", (code,))
    if not referrer or referrer["id"] == referred_id:
        return False
    if db.get("SELECT id FROM referrals WHERE referred_id = ?", (referred_id,)):
        return False

    db.run(
        """
        INSERT INTO referrals (id, referrer_id, referred_id, code, status, reward_cents)
        VALUES (?, ?, ?, ?, 'pending', ?)
        """,
        (str(uuid.uuid4()), referrer["id"], referred_id, code, REWARD_CENTS),
    )

    try:
        notifications.notify(
            referrer["id"],
            "referral",
            "New Referral",
            "Someone joined TradeHub using your link. You will earn store credit once they complete their first purchase.",
        )
    except Exception:
        pass
    return True


def credit_first_purchase(user_id):
    """Credit the referral reward item once a referred buyer finishes their first purchase."""
    referral = db.get(
        "SELECT * FROM referrals WHERE referred_id = ? AND status = 'pending'", (user_id,)
    )
    if not referral:
        return
    completed = db.get(
        "SELECT COUNT(*) as c FROM transactions WHERE buyer_id = ? AND status = 'completed'",
        (user_id,),
    )["c"]
    if completed > 1:
        return

    wallet = db.get("SELECT available_cents FROM wallets WHERE user_id = ?", (referral["referrer_id"],))
    available = (wallet["available_cents"] if wallet else 0) + referral["reward_cents"]
    db.run(
        """
        INSERT INTO wallets (user_id, available_cents, lifetime_cents)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          available_cents = available_cents + ?,
          lifetime_cents = lifetime_cents + ?
        """,
        (referral["referrer_id"], available, available, referral["reward_cents"], referral["reward_cents"]),
    )

    db.run(
        "UPDATE referrals SET status = 'credited', credited_at = datetime('now') WHERE id = ?",
        (referral["id"],),
    )

    try:
        notifications.notify(
            referral["referrer_id"],
            "referral",
            "Referral Reward Earned",
            f"You earned \u20a6{referral['reward_cents'] / 100:.2f} store credit from your referral!",
        )
    except Exception:
        pass