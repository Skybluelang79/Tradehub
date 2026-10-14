import uuid

from . import db, notifications

REWARD_CENTS = 100000


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