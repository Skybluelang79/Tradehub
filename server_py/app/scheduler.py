import json
import logging
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from . import config, db
from .datetime_util import parse_iso, utc_now
from .notifications import notify
from .routers.payments import expire_awaiting_payment, finalize_completed

logger = logging.getLogger("tradehub")

AUTO_RELEASE_DAYS = max(1, config.AUTO_RELEASE_DAYS)
ABANDON_HOURS = max(1, config.ABANDON_PAYMENT_HOURS)


def _format_ng_amount(value):
    # Mirrors JS Number(value).toLocaleString('en-NG'): thousands separators and
    # no trailing ".0" for integral values.
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)
    if num == int(num):
        return f"{int(num):,}"
    return f"{num:,}"


def run_escrow_auto_release():
    try:
        due = db.all(
            "SELECT * FROM transactions WHERE status = 'pending' AND created_at <= datetime('now', ?)",
            (f"-{AUTO_RELEASE_DAYS} days",),
        )

        released = 0
        for txn in due:
            try:
                if finalize_completed(txn):
                    released += 1
            except Exception as err:
                logger.error("Auto-release failed for txn %s: %s", txn["id"], err)
        logger.info(
            "Escrow auto-release: %s transaction(s) released after %s day(s)",
            released,
            AUTO_RELEASE_DAYS,
        )
    except Exception:
        logger.exception("Scheduler error (escrow auto-release)")


def run_abandoned_payment_cleanup():
    try:
        abandoned = db.all(
            "SELECT * FROM transactions WHERE status = 'awaiting_payment' AND created_at <= datetime('now', ?)",
            (f"-{ABANDON_HOURS} hours",),
        )

        expired = 0
        for txn in abandoned:
            try:
                if expire_awaiting_payment(txn):
                    expired += 1
            except Exception as err:
                logger.error("Expire failed for txn %s: %s", txn["id"], err)
        logger.info(
            "Abandoned payments cleanup: %s transaction(s) expired after %s hour(s)",
            expired,
            ABANDON_HOURS,
        )
    except Exception:
        logger.exception("Scheduler error (abandoned payments cleanup)")


def run_auction_finalize():
    try:
        candidates = db.all(
            """
            SELECT * FROM items
            WHERE is_auction = 1 AND status = 'active' AND auction_status = 'active'
              AND auction_ends_at IS NOT NULL
            """
        )
        now = utc_now()
        ended = [item for item in candidates if parse_iso(item.get("auction_ends_at")) and parse_iso(item["auction_ends_at"]) <= now]

        for item in ended:
            if item.get("current_bidder_id") and item.get("current_bid"):
                image = db.get(
                    "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1",
                    (item["id"],),
                )
                image = image["url"] if image else ""
                db.run(
                    """
                    INSERT INTO transactions (id, item_id, item_title, item_image, amount, buyer_id, seller_id, method, provider_ref, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'auction', ?, 'pending')
                    """,
                    (
                        str(uuid.uuid4()),
                        item["id"],
                        item["title"],
                        image,
                        item["current_bid"],
                        item["current_bidder_id"],
                        item["seller_id"],
                        f"auction_{item['id']}",
                    ),
                )
                db.run("UPDATE items SET status = 'sold', auction_status = 'ended' WHERE id = ?", (item["id"],))
                notify(
                    item["current_bidder_id"],
                    "sale",
                    "You won the auction!",
                    f'Your winning bid of ₦{_format_ng_amount(item["current_bid"])} for "{item["title"]}" is held in escrow.',
                    data=json.dumps({"itemId": item["id"]}),
                )
                notify(
                    item["seller_id"],
                    "sale",
                    "Auction ended with a sale",
                    f'"{item["title"]}" sold at auction for ₦{_format_ng_amount(item["current_bid"])}.',
                    data=json.dumps({"itemId": item["id"]}),
                )
                logger.info("Auction sold: %s (%s) for ₦%s", item["title"], item["id"], item["current_bid"])
            else:
                db.run("UPDATE items SET auction_status = 'ended' WHERE id = ?", (item["id"],))
                notify(
                    item["seller_id"],
                    "system",
                    "Auction ended with no bids",
                    f'Your auction for "{item["title"]}" ended with no bids. It remains available as a fixed-price listing.',
                    data=json.dumps({"itemId": item["id"]}),
                )
                logger.info("Auction ended with no bids: %s (%s)", item["title"], item["id"])
    except Exception:
        logger.exception("Scheduler error (auction finalize)")


def run_saved_search_alerts():
    try:
        recent_items = db.all(
            """
            SELECT id, title, price, sale_price, category, seller_id
            FROM items
            WHERE status = 'active' AND created_at >= datetime('now', '-2 hours')
            """
        )
        if not recent_items:
            return

        searches = db.all("SELECT * FROM saved_searches")
        notified = 0
        for s in searches:
            terms = [t for t in str(s.get("query") or "").lower().split() if t]
            for item in recent_items:
                if item.get("seller_id") == s.get("user_id"):
                    continue
                title = str(item.get("title") or "").lower()
                if terms and not all(t in title for t in terms):
                    continue
                if s.get("category") and item.get("category") and str(s["category"]).lower() != str(item["category"]).lower():
                    continue
                price = item["sale_price"] if item.get("sale_price") is not None else item["price"]
                if s.get("min_price") is not None and price < s["min_price"]:
                    continue
                if s.get("max_price") is not None and price > s["max_price"]:
                    continue

                notify(
                    s["user_id"],
                    "saved_search",
                    f'New match for "{s["name"]}"',
                    f'{item["title"]} is now ₦{_format_ng_amount(price)}',
                    data=json.dumps({"itemId": item["id"], "searchId": s["id"]}),
                )
                notified += 1
        if notified > 0:
            logger.info("Saved-search alerts sent: %s", notified)
    except Exception:
        logger.exception("Scheduler error (saved-search alerts)")


def run_price_drop_alerts():
    try:
        candidates = db.all(
            """
            SELECT f.user_id, f.item_id, f.price_at_add, i.title, i.price, i.sale_price
            FROM favorites f
            JOIN items i ON i.id = f.item_id
            WHERE i.status = 'active'
              AND f.price_at_add IS NOT NULL
              AND COALESCE(i.sale_price, i.price) < f.price_at_add
            """
        )

        notified = 0
        for fav in candidates:
            settings = db.get(
                "SELECT notif_price_drops FROM user_settings WHERE user_id = ?", (fav["user_id"],)
            )
            if settings and settings["notif_price_drops"] == 0:
                continue

            new_price = fav["sale_price"] if fav.get("sale_price") is not None else fav["price"]
            notify(
                fav["user_id"],
                "price_drop",
                f'Price dropped on "{fav["title"]}"',
                f"The item you favorited is now ₦{_format_ng_amount(new_price)}",
                data=json.dumps({"itemId": fav["item_id"]}),
            )
            db.run(
                "UPDATE favorites SET price_at_add = ? WHERE user_id = ? AND item_id = ?",
                (new_price, fav["user_id"], fav["item_id"]),
            )
            notified += 1
        if notified > 0:
            logger.info("Price-drop alerts sent: %s", notified)
    except Exception:
        logger.exception("Scheduler error (price-drop alerts)")


def run_scheduled_jobs():
    logger.info("Running scheduled jobs...")

    try:
        expired = db.all(
            "SELECT id, title FROM items WHERE boosted = 1 AND boost_expires_at < datetime('now')"
        )

        db.run(
            "UPDATE items SET boosted = 0, boost_expires_at = NULL "
            "WHERE boosted = 1 AND boost_expires_at < datetime('now')"
        )

        for item in expired:
            logger.info("Boost expired for item: %s (%s)", item["title"], item["id"])

        logger.info("Expired boosts cleared: %s items", len(expired))
    except Exception:
        logger.exception("Scheduler error (boost expiry)")

    try:
        db.run(
            "DELETE FROM notifications WHERE read = 1 AND created_at < datetime('now', '-30 days')"
        )
        logger.info("Old notifications cleaned up")
    except Exception:
        logger.exception("Scheduler error (notification cleanup)")

    run_abandoned_payment_cleanup()
    run_escrow_auto_release()
    run_price_drop_alerts()
    run_saved_search_alerts()
    run_auction_finalize()


_started = False
_start_lock = threading.Lock()


def _seconds_until_next_hour():
    now = datetime.now(timezone.utc)
    next_hour = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return max(0.0, (next_hour - now).total_seconds())


def _scheduler_loop():
    # Mirrors cron.schedule('0 * * * *'): fire at the top of every hour.
    while True:
        time.sleep(_seconds_until_next_hour())
        try:
            run_scheduled_jobs()
        except Exception:
            logger.exception("Scheduled job run failed")


def start_scheduler():
    # Idempotent: safe to call on app startup more than once.
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    thread = threading.Thread(target=_scheduler_loop, name="tradehub-scheduler", daemon=True)
    thread.start()
    logger.info("Scheduler started")
