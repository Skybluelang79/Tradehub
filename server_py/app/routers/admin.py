import json
import logging
import os
import platform
import secrets
import sys
import time
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response

from .. import config, db
from ..deps import require_admin
from ..email import send_notification_email
from ..notifications import notify
from ..security import generate_token
from .payments import refund_txn

logger = logging.getLogger("tradehub")

router = APIRouter()

ADMIN_EMAIL = "admin@tradehub.com"
ADMIN_ID = "admin-1"
USER_STATUSES = ["active", "suspended", "banned"]

_START_TIME = time.time()


def _log_audit(admin_id, action, entity_type, entity_id=None, details=None):
    try:
        db.run(
            "INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, details) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), admin_id, action, entity_type, entity_id, json.dumps(details or {})),
        )
    except Exception as err:
        logger.error("Audit log error: %s", err)


def _paginate(page, limit):
    try:
        p = int(page)
    except (TypeError, ValueError):
        p = 1
    try:
        l = int(limit)
    except (TypeError, ValueError):
        l = 20
    p = max(p, 1)
    l = min(max(l, 1), 100)
    return p, l, (p - 1) * l


def _random_password():
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
    return "".join(chars[secrets.randbelow(len(chars))] for _ in range(10))


def _csv_escape(value):
    s = "" if value is None else str(value)
    if any(c in s for c in ('"', ",", "\n")):
        return '"' + s.replace('"', '""') + '"'
    return s


def _csv_row(values):
    return ",".join(_csv_escape(v) for v in values)


def _send_csv(filename, headers, rows):
    lines = [_csv_row(headers)] + [_csv_row([row.get(h) for h in headers]) for row in rows]
    body = "\ufeff" + "\r\n".join(lines)
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def ensure_admin_row():
    admin = db.get("SELECT id FROM users WHERE email = ?", (ADMIN_EMAIL,))
    if admin:
        db.run(
            "UPDATE users SET is_admin = 1, "
            "status = CASE WHEN status IS NULL OR status = '' THEN 'active' ELSE status END "
            "WHERE id = ?",
            (admin["id"],),
        )
        return admin["id"]
    from ..security import hash_password

    db.run(
        "INSERT OR IGNORE INTO users (id, name, email, password, avatar, verified, is_admin) "
        "VALUES (?, 'Admin', ?, ?, 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 1, 1)",
        (ADMIN_ID, ADMIN_EMAIL, hash_password(config.ADMIN_PASSWORD)),
    )
    db.run("UPDATE users SET is_admin = 1 WHERE id = ?", (ADMIN_ID,))
    return ADMIN_ID


def _export_database():
    return bytes(db.connect().serialize())


def _replace_database(buffer):
    conn = db.connect()
    conn.deserialize(buffer)
    from .. import migrations

    migrations.apply()


# ---- Login ------------------------------------------------------------------


@router.post("/login")
def admin_login(body: dict = Body(...)):
    email = body.get("email")
    password = body.get("password")
    if email != ADMIN_EMAIL or password != config.ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail={"error": "Invalid admin credentials"})
    admin_id = ensure_admin_row()
    # Carry the same `isAdmin` claim the Node backend signs, so an admin token
    # issued here is still accepted if the frontend is later pointed at the
    # Node server (its adminAuth gate checks decoded.isAdmin).
    token = generate_token(admin_id, isAdmin=True)
    _log_audit(admin_id, "admin_login", "user", admin_id)
    return {"token": token}


# ---- Dashboard --------------------------------------------------------------


@router.get("/dashboard")
def admin_dashboard(admin: dict = Depends(require_admin)):
    total_users = db.get("SELECT COUNT(*) as count FROM users")["count"]
    total_items = db.get("SELECT COUNT(*) as count FROM items")["count"]
    active_items = db.get("SELECT COUNT(*) as count FROM items WHERE status = 'active'")["count"]
    total_transactions = db.get("SELECT COUNT(*) as count FROM transactions")["count"]
    total_revenue = db.get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'completed'")["total"]
    total_fees = db.get("SELECT COALESCE(SUM(fee_amount), 0) as total FROM transactions WHERE status = 'completed'")["total"]
    pending_reports = db.get("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'")["count"]
    pending_user_reports = db.get("SELECT COUNT(*) as count FROM user_reports WHERE status = 'pending'")["count"]
    open_disputes = db.get("SELECT COUNT(*) as count FROM disputes WHERE status = 'open'")["count"]
    flagged_listings = db.get("SELECT COUNT(*) as count FROM items WHERE status = 'flagged'")["count"]
    pending_verifications = db.get(
        "SELECT COUNT(*) as count FROM email_verifications WHERE used = 0 AND expires_at > datetime('now')"
    )["count"]
    total_views = db.get("SELECT COALESCE(SUM(views), 0) as total FROM items")["total"]
    pending_payouts = db.get(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM payouts WHERE status IN ('pending','approved')"
    )["total"]
    paid_out = db.get(
        "SELECT COALESCE(SUM(amount_cents), 0) as total FROM payouts WHERE status = 'completed'"
    )["total"]
    active_wallets = db.get("SELECT COUNT(*) as count FROM wallets WHERE available_cents > 0")["count"]
    gift_cards_issued = db.get(
        "SELECT COUNT(*) as count FROM gift_cards WHERE status != 'voided'"
    )["count"]
    gift_cards_redeemed = db.get("SELECT COUNT(*) as count FROM gift_cards WHERE status = 'redeemed'")["count"]

    recent_users = db.all(
        "SELECT id, name, email, avatar, created_at FROM users ORDER BY created_at DESC LIMIT 5"
    )
    recent_items = db.all(
        "SELECT id, title, price, status, views, created_at FROM items ORDER BY created_at DESC LIMIT 5"
    )
    top_viewed_items = db.all(
        "SELECT id, title, price, views, status FROM items ORDER BY views DESC LIMIT 5"
    )
    recent_transactions = db.all(
        """
        SELECT t.id, t.item_title, t.amount, t.fee_amount, t.status, t.created_at,
          buyer.name as buyer_name, seller.name as seller_name
        FROM transactions t
        LEFT JOIN users buyer ON buyer.id = t.buyer_id
        LEFT JOIN users seller ON seller.id = t.seller_id
        ORDER BY t.created_at DESC LIMIT 5
        """
    )
    revenue_by_day = db.all(
        """
        SELECT DATE(completed_at) as date, SUM(amount) as revenue, COUNT(*) as sales
        FROM transactions WHERE status = 'completed' AND completed_at > datetime('now', '-30 days')
        GROUP BY DATE(completed_at) ORDER BY date
        """
    )
    top_categories = db.all(
        """
        SELECT category, COUNT(*) as count FROM items WHERE status = 'active'
        GROUP BY category ORDER BY count DESC LIMIT 5
        """
    )
    user_signups_by_day = db.all(
        """
        SELECT DATE(created_at) as date, COUNT(*) as count
        FROM users WHERE created_at > datetime('now', '-30 days')
        GROUP BY DATE(created_at) ORDER BY date
        """
    )

    recent_pending_reports = db.all(
        """
        SELECT 'item' as type, r.id, r.reason, r.created_at, i.title as target, u.name as reporter
        FROM reports r
        JOIN items i ON i.id = r.item_id
        JOIN users u ON u.id = r.reporter_id
        WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5
        """
    )
    recent_pending_user_reports = db.all(
        """
        SELECT 'user' as type, r.id, r.reason, r.created_at, u2.name as target, u.name as reporter
        FROM user_reports r
        JOIN users u ON u.id = r.reporter_id
        JOIN users u2 ON u2.id = r.reported_user_id
        WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5
        """
    )
    recent_flagged = db.all(
        "SELECT id, title, price, views FROM items WHERE status = 'flagged' ORDER BY updated_at DESC LIMIT 5"
    )
    recent_disputes = db.all(
        """
        SELECT d.id, d.reason, d.created_at, t.item_title, u.name as opened_by
        FROM disputes d
        LEFT JOIN transactions t ON t.id = d.transaction_id
        LEFT JOIN users u ON u.id = d.opened_by
        WHERE d.status = 'open' ORDER BY d.created_at DESC LIMIT 5
        """
    )

    return {
        "stats": {
            "totalUsers": total_users,
            "totalItems": total_items,
            "activeItems": active_items,
            "totalTransactions": total_transactions,
            "totalRevenue": total_revenue,
            "totalFees": total_fees,
            "pendingReports": pending_reports + pending_user_reports,
            "pendingUserReports": pending_user_reports,
            "openDisputes": open_disputes,
            "flaggedListings": flagged_listings,
            "pendingVerifications": pending_verifications,
            "totalViews": total_views,
            "pendingPayouts": pending_payouts,
            "paidOut": paid_out,
            "activeWallets": active_wallets,
            "giftCardsIssued": gift_cards_issued,
            "giftCardsRedeemed": gift_cards_redeemed,
        },
        "recentUsers": recent_users,
        "recentItems": recent_items,
        "topViewedItems": top_viewed_items,
        "recentTransactions": recent_transactions,
        "revenueByDay": revenue_by_day,
        "topCategories": top_categories,
        "userSignupsByDay": user_signups_by_day,
        "recentPendingReports": recent_pending_user_reports + recent_pending_reports,
        "recentFlagged": recent_flagged,
        "recentDisputes": recent_disputes,
    }


# ---- Users ------------------------------------------------------------------


@router.get("/users")
def list_users(
    admin: dict = Depends(require_admin),
    page: str = Query("1"),
    limit: str = Query("20"),
    q: str = Query(""),
    status: str = Query("all"),
):
    page, limit, offset = _paginate(page, limit)
    q = (q or "").strip()
    status = status or "all"

    where = []
    params = []
    if q:
        where.append("(name LIKE ? OR email LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])
    if status == "pending":
        where.append("verified = 0")
    elif status != "all":
        where.append("status = ?")
        params.append(status)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    total = db.get(f"SELECT COUNT(*) as count FROM users {where_sql}", tuple(params))["count"]
    users = db.all(
        f"""
        SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, is_admin, status,
          banned_reason, created_at,
          (SELECT COUNT(*) FROM items WHERE seller_id = users.id) as listing_count
        FROM users {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?
        """,
        tuple(params) + (limit, offset),
    )

    return {"users": users, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


@router.get("/users/{user_id}")
def get_user_detail(user_id: str, admin: dict = Depends(require_admin)):
    user = db.get(
        "SELECT id, name, email, avatar, bio, phone, verified, rating, review_count, is_admin, status, "
        "banned_reason, created_at FROM users WHERE id = ?",
        (user_id,),
    )
    if not user:
        raise HTTPException(status_code=404, detail={"error": "User not found"})

    listings = db.all(
        "SELECT id, title, price, status, views, created_at FROM items WHERE seller_id = ? ORDER BY created_at DESC",
        (user["id"],),
    )
    transactions = db.all(
        """
        SELECT t.id, t.item_title, t.amount, t.fee_amount, t.status, t.created_at, t.buyer_id, t.seller_id
        FROM transactions t WHERE t.buyer_id = ? OR t.seller_id = ? ORDER BY t.created_at DESC LIMIT 20
        """,
        (user["id"], user["id"]),
    )
    reviews = db.all(
        """
        SELECT r.rating, r.text, r.created_at, u.name as reviewer FROM reviews r
        JOIN users u ON u.id = r.reviewer_id WHERE r.reviewee_id = ? ORDER BY r.created_at DESC LIMIT 10
        """,
        (user["id"],),
    )
    subscription = db.get("SELECT plan, status FROM subscriptions WHERE user_id = ?", (user["id"],)) or None

    return {
        "user": {**user, "listing_count": len(listings)},
        "listings": listings,
        "transactions": transactions,
        "reviews": reviews,
        "subscription": subscription,
    }


@router.put("/users/{user_id}/verify")
def verify_user(user_id: str, admin: dict = Depends(require_admin)):
    db.run("UPDATE users SET verified = 1 WHERE id = ?", (user_id,))
    _log_audit(admin["id"], "user_verified", "user", user_id)
    return {"success": True}


@router.put("/users/{user_id}/status")
def update_user_status(user_id: str, body: dict = Body(...), admin: dict = Depends(require_admin)):
    status = body.get("status")
    reason = body.get("reason", "") or ""
    if status not in USER_STATUSES:
        raise HTTPException(
            status_code=400,
            detail={"error": f"Status must be one of: {', '.join(USER_STATUSES)}"},
        )
    target = db.get("SELECT id, email FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    if target["email"] == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail={"error": "Cannot change status of the primary admin account"})
    db.run(
        "UPDATE users SET status = ?, banned_reason = ?, updated_at = datetime('now') WHERE id = ?",
        (status, reason if status == "banned" else "", user_id),
    )
    if status != "active":
        db.run(
            "UPDATE items SET status = 'removed' WHERE seller_id = ? AND status != 'removed'",
            (user_id,),
        )
    _log_audit(admin["id"], f"user_{status}", "user", user_id, {"reason": reason})
    return {"success": True}


@router.put("/users/{user_id}/promote")
def promote_user(user_id: str, admin: dict = Depends(require_admin)):
    target = db.get("SELECT id, email, is_admin FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    if target["email"] == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail={"error": "Cannot change role of the primary admin account"})
    next_value = 0 if target["is_admin"] else 1
    db.run(
        "UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?",
        (next_value, user_id),
    )
    _log_audit(admin["id"], "admin_promoted" if next_value else "admin_demoted", "user", user_id)
    return {"success": True, "isAdmin": bool(next_value)}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(user_id: str, admin: dict = Depends(require_admin)):
    target = db.get("SELECT id FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    from ..security import hash_password

    temp_password = _random_password()
    db.run(
        "UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?",
        (hash_password(temp_password), user_id),
    )
    _log_audit(admin["id"], "password_reset", "user", user_id)
    return {"success": True, "tempPassword": temp_password}


@router.delete("/users/{user_id}")
def delete_user(user_id: str, admin: dict = Depends(require_admin)):
    target = db.get("SELECT id, email FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    if target["email"] == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail={"error": "Cannot delete the primary admin account"})

    uid = target["id"]
    db.run("DELETE FROM refresh_tokens WHERE user_id = ?", (uid,))
    db.run("DELETE FROM notifications WHERE user_id = ?", (uid,))
    db.run(
        "DELETE FROM favorites WHERE user_id = ? OR item_id IN (SELECT id FROM items WHERE seller_id = ?)",
        (uid, uid),
    )
    db.run("DELETE FROM follows WHERE follower_id = ? OR following_id = ?", (uid, uid))
    db.run("DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?", (uid, uid))
    db.run("DELETE FROM item_images WHERE item_id IN (SELECT id FROM items WHERE seller_id = ?)", (uid,))
    db.run("DELETE FROM items WHERE seller_id = ?", (uid,))
    db.run("DELETE FROM conversations WHERE buyer_id = ? OR seller_id = ?", (uid, uid))
    db.run(
        "DELETE FROM messages WHERE conversation_id IN "
        "(SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?)",
        (uid, uid),
    )
    db.run("DELETE FROM reviews WHERE reviewer_id = ? OR reviewee_id = ?", (uid, uid))
    db.run("DELETE FROM payment_methods WHERE user_id = ?", (uid,))
    db.run("DELETE FROM templates WHERE user_id = ?", (uid,))
    db.run("DELETE FROM user_settings WHERE user_id = ?", (uid,))
    db.run("DELETE FROM user_reports WHERE reported_user_id = ? OR reporter_id = ?", (uid, uid))
    db.run("DELETE FROM reports WHERE reporter_id = ?", (uid,))
    db.run(
        "DELETE FROM disputes WHERE opened_by = ? OR transaction_id IN "
        "(SELECT id FROM transactions WHERE buyer_id = ? OR seller_id = ?)",
        (uid, uid, uid),
    )
    db.run("DELETE FROM subscriptions WHERE user_id = ?", (uid,))
    db.run("DELETE FROM wallets WHERE user_id = ?", (uid,))
    db.run("DELETE FROM payouts WHERE user_id = ?", (uid,))
    db.run("DELETE FROM gift_card_designs WHERE user_id = ?", (uid,))
    db.run("DELETE FROM gift_cards WHERE redeemed_by = ?", (uid,))
    db.run("DELETE FROM transactions WHERE buyer_id = ? OR seller_id = ?", (uid, uid))
    db.run("DELETE FROM email_verifications WHERE user_id = ?", (uid,))
    db.run("DELETE FROM password_resets WHERE email = ?", (target["email"],))
    db.run("DELETE FROM users WHERE id = ?", (uid,))
    _log_audit(admin["id"], "user_deleted", "user", uid, {"email": target["email"]})
    return {"success": True}


# ---- Verifications ----------------------------------------------------------


@router.get("/verifications")
def list_verifications(
    admin: dict = Depends(require_admin),
    page: str = Query("1"),
    limit: str = Query("20"),
    status: str = Query("all"),
):
    page, limit, offset = _paginate(page, limit)
    status = status or "all"
    where = "" if status == "all" else "WHERE r.status = ?"
    params = [] if status == "all" else [status]

    total = db.get(
        f"SELECT COUNT(*) as count FROM verification_requests r {where}", tuple(params)
    )["count"]
    requests = db.all(
        f"""
        SELECT r.id, r.user_id, r.id_type, r.id_number, r.id_image_url, r.selfie_url,
          r.status, r.admin_note, r.created_at, r.reviewed_at,
          u.name AS user_name, u.email AS user_email, u.avatar AS user_avatar,
          u.verified AS email_verified, u.identity_verified,
          (SELECT COUNT(*) FROM items i WHERE i.seller_id = r.user_id) AS listing_count
        FROM verification_requests r
        LEFT JOIN users u ON u.id = r.user_id
        {where}
        ORDER BY r.created_at DESC LIMIT ? OFFSET ?
        """,
        tuple(params) + (limit, offset),
    )

    return {"requests": requests, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


@router.post("/verifications/{request_id}/approve")
def approve_verification(request_id: str, admin: dict = Depends(require_admin)):
    request = db.get(
        "SELECT * FROM verification_requests WHERE id = ? AND status = 'pending'", (request_id,)
    )
    if not request:
        raise HTTPException(status_code=400, detail={"error": "Pending verification request not found"})
    db.run(
        "UPDATE verification_requests SET status = 'approved', admin_id = ?, reviewed_at = datetime('now') WHERE id = ?",
        (admin["id"], request["id"]),
    )
    db.run("UPDATE users SET identity_verified = 1 WHERE id = ?", (request["user_id"],))
    notify(
        request["user_id"],
        "verification",
        "Verification Approved",
        "Congratulations! Your seller identity has been verified. You can now list with the Verified Seller badge.",
    )
    _log_audit(admin["id"], "verification_approved", "verification", request["id"], {"user_id": request["user_id"]})
    return {"success": True}


@router.post("/verifications/{request_id}/reject")
def reject_verification(request_id: str, body: dict = Body(default={}), admin: dict = Depends(require_admin)):
    request = db.get(
        "SELECT * FROM verification_requests WHERE id = ? AND status = 'pending'", (request_id,)
    )
    if not request:
        raise HTTPException(status_code=400, detail={"error": "Pending verification request not found"})
    note = str(body.get("note") or "").strip()[:500]
    db.run(
        "UPDATE verification_requests SET status = 'rejected', admin_note = ?, admin_id = ?, "
        "reviewed_at = datetime('now') WHERE id = ?",
        (note, admin["id"], request["id"]),
    )
    notify(
        request["user_id"],
        "verification",
        "Verification Request Update",
        f"Your verification request was rejected: {note}"
        if note
        else "Your verification request was rejected. Please resubmit with a clearer document photo.",
    )
    _log_audit(
        admin["id"],
        "verification_rejected",
        "verification",
        request["id"],
        {"user_id": request["user_id"], "note": note},
    )
    return {"success": True}


# ---- Listings ---------------------------------------------------------------


@router.get("/listings")
def list_listings(
    admin: dict = Depends(require_admin),
    page: str = Query("1"),
    limit: str = Query("20"),
    q: str = Query(""),
    status: str = Query("all"),
):
    page, limit, offset = _paginate(page, limit)
    q = (q or "").strip()
    status = status or "all"

    where = []
    params = []
    if q:
        where.append("(i.title LIKE ? OR u.name LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%"])
    if status != "all":
        where.append("i.status = ?")
        params.append(status)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    total = db.get(
        f"SELECT COUNT(*) as count FROM items i JOIN users u ON i.seller_id = u.id {where_sql}",
        tuple(params),
    )["count"]
    items = db.all(
        f"""
        SELECT i.*, u.name as seller_name
        FROM items i JOIN users u ON i.seller_id = u.id
        {where_sql} ORDER BY i.created_at DESC LIMIT ? OFFSET ?
        """,
        tuple(params) + (limit, offset),
    )
    for item in items:
        images = db.all(
            "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1", (item["id"],)
        )
        item["images"] = [img["url"] for img in images]

    return {"items": items, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


@router.put("/listings/{item_id}/status")
def update_listing_status(item_id: str, body: dict = Body(...), admin: dict = Depends(require_admin)):
    status = body.get("status")
    db.run("UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?", (status, item_id))
    _log_audit(admin["id"], "listing_status_change", "item", item_id, {"status": status})
    return {"success": True}


# ---- Transactions -----------------------------------------------------------


@router.get("/transactions")
def list_transactions(
    admin: dict = Depends(require_admin),
    page: str = Query("1"),
    limit: str = Query("20"),
    q: str = Query(""),
    status: str = Query("all"),
):
    page, limit, offset = _paginate(page, limit)
    q = (q or "").strip()
    status = status or "all"

    where = []
    params = []
    if q:
        where.append("(t.item_title LIKE ? OR buyer.name LIKE ? OR seller.name LIKE ?)")
        params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
    if status != "all":
        where.append("t.status = ?")
        params.append(status)
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""

    total = db.get(
        f"""
        SELECT COUNT(*) as count FROM transactions t
        LEFT JOIN users buyer ON buyer.id = t.buyer_id
        LEFT JOIN users seller ON seller.id = t.seller_id
        {where_sql}
        """,
        tuple(params),
    )["count"]

    transactions = db.all(
        f"""
        SELECT t.id, t.item_title, t.item_image, t.amount, t.fee_amount, t.net_amount, t.status,
          t.method, t.created_at, buyer.name as buyer_name, seller.name as seller_name
        FROM transactions t
        LEFT JOIN users buyer ON buyer.id = t.buyer_id
        LEFT JOIN users seller ON seller.id = t.seller_id
        {where_sql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?
        """,
        tuple(params) + (limit, offset),
    )

    return {"transactions": transactions, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


# ---- Reports ----------------------------------------------------------------


@router.get("/reports")
def list_reports(
    admin: dict = Depends(require_admin),
    page: str = Query("1"),
    limit: str = Query("20"),
    q: str = Query(""),
    status: str = Query("all"),
    type: str = Query("all"),
):
    page, limit, offset = _paginate(page, limit)
    q = (q or "").strip()
    status = status or "all"
    type = type or "all"

    status_where = "" if status == "all" else " AND status = ?"
    status_params = [] if status == "all" else [status]
    item_where = "AND (i.title LIKE ? OR u.name LIKE ?)" if q else ""
    item_params = [f"%{q}%", f"%{q}%"] if q else []
    user_where = "AND (u2.name LIKE ? OR u.name LIKE ?)" if q else ""
    user_params = [f"%{q}%", f"%{q}%"] if q else []

    item_reports = db.all(
        f"""
        SELECT 'item' as type, r.id, r.reason, r.description, r.status, r.created_at,
          i.title as target, u.name as reporter_name, i.status as item_status,
          i.id as item_id, i.price as item_price, i.description as item_description,
          i.seller_id, i.created_at as item_created_at, seller.name as seller_name
        FROM reports r
        JOIN items i ON i.id = r.item_id
        JOIN users u ON u.id = r.reporter_id
        JOIN users seller ON seller.id = i.seller_id
        WHERE 1=1 {status_where} {item_where}
        ORDER BY r.created_at DESC
        """,
        tuple(status_params + item_params),
    )

    user_reports = db.all(
        f"""
        SELECT 'user' as type, ur.id, ur.reason, ur.description, ur.status, ur.created_at,
          u2.name as target, u.name as reporter_name, u2.status as user_status,
          ur.reported_user_id as user_id
        FROM user_reports ur
        JOIN users u ON ur.reporter_id = u.id
        JOIN users u2 ON ur.reported_user_id = u2.id
        WHERE 1=1 {status_where} {user_where}
        ORDER BY ur.created_at DESC
        """,
        tuple(status_params + user_params),
    )

    for report in item_reports:
        images = db.all(
            "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order", (report["item_id"],)
        )
        report["item_images"] = [img["url"] for img in images]

    reports = item_reports + user_reports
    reports.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    if type != "all":
        reports = [r for r in reports if r["type"] == type]

    total = len(reports)
    paged = reports[offset:offset + limit]

    return {"reports": paged, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


@router.put("/reports/{report_id}/resolve")
def resolve_report(report_id: str, body: dict = Body(default={}), admin: dict = Depends(require_admin)):
    action = body.get("action", "warn")

    report = db.get("SELECT * FROM reports WHERE id = ?", (report_id,))
    report_type = "item"
    if not report:
        report = db.get("SELECT * FROM user_reports WHERE id = ?", (report_id,))
        report_type = "user"
    if not report:
        raise HTTPException(status_code=404, detail={"error": "Report not found"})

    if action == "dismiss":
        if report_type == "item":
            db.run(
                "UPDATE reports SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?",
                (report_id,),
            )
        else:
            db.run(
                "UPDATE user_reports SET status = 'dismissed', resolved_at = datetime('now') WHERE id = ?",
                (report_id,),
            )
        _log_audit(
            admin["id"],
            "report_dismissed",
            "report" if report_type == "item" else "user_report",
            report_id,
            {"action": action},
        )
        return {"success": True}

    if report_type == "item":
        db.run(
            "UPDATE reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?",
            (report_id,),
        )
        if action == "remove":
            db.run("UPDATE items SET status = 'removed' WHERE id = ?", (report["item_id"],))
        else:
            db.run("UPDATE items SET status = 'active' WHERE id = ?", (report["item_id"],))
    else:
        db.run(
            "UPDATE user_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?",
            (report_id,),
        )
        if action == "suspend":
            db.run("UPDATE users SET status = 'suspended' WHERE id = ?", (report["reported_user_id"],))
            db.run("UPDATE items SET status = 'removed' WHERE seller_id = ?", (report["reported_user_id"],))

    _log_audit(
        admin["id"],
        "report_resolved",
        "report" if report_type == "item" else "user_report",
        report_id,
        {"action": action},
    )
    return {"success": True}


# ---- Audit logs -------------------------------------------------------------


@router.get("/audit-logs")
def list_audit_logs(
    admin: dict = Depends(require_admin),
    page: str = Query("1"),
    limit: str = Query("20"),
    q: str = Query(""),
):
    page, limit, offset = _paginate(page, limit)
    q = (q or "").strip()
    where = "WHERE action LIKE ? OR entity_type LIKE ?" if q else ""
    params = [f"%{q}%", f"%{q}%"] if q else []
    total = db.get(f"SELECT COUNT(*) as count FROM audit_logs {where}", tuple(params))["count"]
    logs = db.all(
        f"""
        SELECT l.*, u.name as admin_name FROM audit_logs l
        LEFT JOIN users u ON u.id = l.admin_id
        {where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?
        """,
        tuple(params) + (limit, offset),
    )
    return {"logs": logs, "total": total, "page": page, "limit": limit, "totalPages": (total + limit - 1) // limit}


# ---- Export -----------------------------------------------------------------


@router.get("/export/{kind}")
def export_csv(kind: str, admin: dict = Depends(require_admin)):
    if kind == "users":
        rows = db.all(
            "SELECT id, name, email, verified, is_admin, status, rating, review_count, created_at "
            "FROM users ORDER BY created_at DESC"
        )
        return _send_csv(
            f"users-{int(time.time() * 1000)}.csv",
            ["id", "name", "email", "verified", "is_admin", "status", "rating", "review_count", "created_at"],
            rows,
        )
    if kind == "transactions":
        rows = db.all(
            """
            SELECT t.id, t.item_title, t.amount, t.fee_amount, t.net_amount, t.status, t.method,
              t.created_at, buyer.name as buyer_name, seller.name as seller_name
            FROM transactions t
            LEFT JOIN users buyer ON buyer.id = t.buyer_id
            LEFT JOIN users seller ON seller.id = t.seller_id
            ORDER BY t.created_at DESC
            """
        )
        return _send_csv(
            f"transactions-{int(time.time() * 1000)}.csv",
            ["id", "item_title", "buyer_name", "seller_name", "amount", "fee_amount", "net_amount", "status", "method", "created_at"],
            rows,
        )
    if kind == "payouts":
        rows = db.all(
            """
            SELECT p.id, u.name as user_name, p.amount_cents, p.fee_cents, p.method, p.status,
              p.created_at, p.processed_at
            FROM payouts p LEFT JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC
            """
        )
        return _send_csv(
            f"payouts-{int(time.time() * 1000)}.csv",
            ["id", "user_name", "amount_cents", "fee_cents", "method", "status", "created_at", "processed_at"],
            rows,
        )
    raise HTTPException(status_code=400, detail={"error": "Invalid export type"})


# ---- Broadcast --------------------------------------------------------------


@router.post("/broadcast")
def broadcast(body: dict = Body(...), admin: dict = Depends(require_admin)):
    title = body.get("title")
    message = body.get("body")
    ntype = body.get("type", "announcement")
    if not title or not str(title).strip():
        raise HTTPException(status_code=400, detail={"error": "Title is required"})
    if not message or not str(message).strip():
        raise HTTPException(status_code=400, detail={"error": "Body is required"})

    user_ids = db.all("SELECT id FROM users")
    for u in user_ids:
        notify(u["id"], ntype, title, message)
    _log_audit(admin["id"], "broadcast", "notification", None, {"title": title, "recipients": len(user_ids)})
    return {"success": True, "recipients": len(user_ids)}


# ---- Backup / restore -------------------------------------------------------


@router.get("/backup")
def download_backup(admin: dict = Depends(require_admin)):
    buf = _export_database()
    _log_audit(admin["id"], "db_backup", "database", None, {"size": len(buf)})
    return Response(
        content=buf,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="tradehub-backup-{int(time.time() * 1000)}.db"'},
    )


@router.post("/backup")
def restore_backup(body: dict = Body(...), admin: dict = Depends(require_admin)):
    import base64

    data = body.get("data")
    if not data or not isinstance(data, str):
        raise HTTPException(status_code=400, detail={"error": "Base64 database payload required"})
    buffer = base64.b64decode(data)
    if len(buffer) < 1000:
        raise HTTPException(status_code=400, detail={"error": "Invalid database payload"})
    _replace_database(buffer)
    _log_audit(admin["id"], "db_restore", "database", None, {"size": len(buffer)})
    return {"success": True, "size": len(buffer)}


# ---- Platform settings ------------------------------------------------------


def _platform_settings():
    rows = db.all("SELECT * FROM platform_settings ORDER BY key")
    return {row["key"]: row["value"] for row in rows}


@router.get("/settings")
def get_platform_settings(admin: dict = Depends(require_admin)):
    return {"settings": _platform_settings()}


@router.put("/settings")
def update_platform_settings(body: dict = Body(...), admin: dict = Depends(require_admin)):
    allowed = [
        "site_name",
        "support_email",
        "maintenance_mode",
        "platform_fee_percent",
        "currency",
        "terms_url",
        "privacy_url",
        "about_text",
    ]
    updated = []
    for key in allowed:
        if key in body and body[key] is not None:
            db.run(
                "UPDATE platform_settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
                (str(body[key]), key),
            )
            updated.append(key)
    _log_audit(admin["id"], "settings_update", "platform_settings", None, {"updated": updated})
    return {"success": True, "settings": _platform_settings()}


# ---- Bulk item delete -------------------------------------------------------


@router.delete("/items/bulk")
def bulk_delete_items(admin: dict = Depends(require_admin)):
    dependents = [
        "message_attachments",
        "messages",
        "disputes",
        "payouts",
        "reviews",
        "bids",
        "offers",
        "favorites",
        "carts",
        "item_variants",
        "item_images",
        "reports",
        "conversations",
        "transactions",
    ]
    existing = {
        row["name"]
        for row in db.all("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    removed = {}
    statements = ["BEGIN TRANSACTION;"]
    for table in dependents:
        if table not in existing:
            continue
        removed[table] = db.get(f"SELECT COUNT(*) as c FROM {table}")["c"]
        statements.append(f"DELETE FROM {table};")
    removed["items"] = db.get("SELECT COUNT(*) as c FROM items")["c"]
    statements.append("DELETE FROM items;")
    statements.append("COMMIT;")
    db.exec("\n".join(statements))

    _log_audit(admin["id"], "items_bulk_delete", "items", None, {"removed": removed})
    logger.warning("All listings deleted by admin: adminId=%s removed=%s", admin["id"], removed)
    return {"success": True, "removed": removed}


# ---- System info ------------------------------------------------------------


def _pkg_info():
    try:
        path = config.BASE_DIR.parent / "server" / "package.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("name", "tradehub-server"), data.get("version", "1.0.0")
    except Exception:
        return "tradehub-server", "1.0.0"


def _memory_usage():
    try:
        import resource

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform != "darwin":
            rss *= 1024
        return {"rss": rss, "heapUsed": 0}
    except Exception:
        return {"rss": 0, "heapUsed": 0}


@router.get("/system-info")
def system_info(admin: dict = Depends(require_admin)):
    buf = _export_database()
    pending_reports = (
        db.get("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'")["c"]
        + db.get("SELECT COUNT(*) as c FROM user_reports WHERE status = 'pending'")["c"]
    )
    name, version = _pkg_info()
    return {
        "version": version,
        "name": name,
        "node": f"Python {platform.python_version()}",
        "platform": sys.platform,
        "arch": platform.machine(),
        "uptimeSeconds": round(time.time() - _START_TIME),
        "memory": _memory_usage(),
        "env": os.environ.get("NODE_ENV") or "development",
        "dbMode": "blob" if config.USE_BLOB else "file",
        "dbSize": len(buf),
        "counts": {
            "users": db.get("SELECT COUNT(*) as c FROM users")["c"],
            "items": db.get("SELECT COUNT(*) as c FROM items")["c"],
            "transactions": db.get("SELECT COUNT(*) as c FROM transactions")["c"],
            "notifications": db.get("SELECT COUNT(*) as c FROM notifications")["c"],
            "pendingReports": pending_reports,
        },
        "now": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
    }


# ---- Admin refund -----------------------------------------------------------


@router.post("/transactions/{txn_id}/refund")
def admin_refund(txn_id: str, admin: dict = Depends(require_admin)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["status"] == "refunded":
        raise HTTPException(status_code=400, detail={"error": "Transaction already refunded"})
    try:
        refund_txn(txn)
    except Exception as err:
        logger.error("Admin refund error: %s", err)
        raise HTTPException(status_code=500, detail={"error": "Internal server error"})
    try:
        buyer = db.get("SELECT email FROM users WHERE id = ?", (txn["buyer_id"],))
        if buyer and buyer.get("email"):
            send_notification_email(
                buyer["email"],
                "Refund issued",
                f'Your payment for "{txn["item_title"]}" has been refunded by TradeHub.',
            )
    except Exception:
        pass
    _log_audit(admin["id"], "refund", "transaction", txn["id"], {"amount": txn["amount"]})
    return {"success": True}


# ---- Promotions -------------------------------------------------------------


@router.get("/promotions")
def list_promotions(admin: dict = Depends(require_admin)):
    promotions = db.all("SELECT * FROM promotions ORDER BY created_at DESC")
    return {"promotions": promotions}


@router.post("/promotions", status_code=201)
def create_promotion(body: dict = Body(...), admin: dict = Depends(require_admin)):
    code = body.get("code")
    discount_type = body.get("discount_type")
    discount_value = body.get("discount_value")
    max_uses = body.get("max_uses")
    expires_at = body.get("expires_at")
    min_purchase = body.get("min_purchase")
    active = body.get("active")

    if not code or not str(code).strip():
        raise HTTPException(status_code=400, detail={"error": "Code is required"})
    if discount_type not in ("percentage", "fixed"):
        raise HTTPException(status_code=400, detail={"error": "discount_type must be percentage or fixed"})
    try:
        value = float(discount_value)
    except (TypeError, ValueError):
        value = float("nan")
    if value != value or value <= 0:
        raise HTTPException(status_code=400, detail={"error": "Valid discount_value is required"})

    normalized = str(code).strip().upper()
    existing = db.get("SELECT id FROM promotions WHERE code = ?", (normalized,))
    if existing:
        raise HTTPException(status_code=409, detail={"error": "Promotion code already exists"})

    promo_id = str(uuid.uuid4())
    db.run(
        """
        INSERT INTO promotions (id, code, discount_type, discount_value, max_uses, expires_at, min_purchase, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            promo_id,
            normalized,
            discount_type,
            value,
            max_uses or 0,
            expires_at or None,
            min_purchase or None,
            1 if (active if active is not None else True) else 0,
        ),
    )
    _log_audit(admin["id"], "promotion_create", "promotion", promo_id, {"code": normalized})
    return {"promotion": db.get("SELECT * FROM promotions WHERE id = ?", (promo_id,))}


@router.put("/promotions/{promo_id}")
def update_promotion(promo_id: str, body: dict = Body(...), admin: dict = Depends(require_admin)):
    existing = db.get("SELECT * FROM promotions WHERE id = ?", (promo_id,))
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Promotion not found"})

    code = body.get("code")
    discount_type = body.get("discount_type")
    discount_value = body.get("discount_value")
    max_uses = body.get("max_uses")
    expires_at = body.get("expires_at")
    min_purchase = body.get("min_purchase")
    active = body.get("active")

    db.run(
        """
        UPDATE promotions SET code = ?, discount_type = ?, discount_value = ?, max_uses = ?,
          expires_at = ?, min_purchase = ?, active = ?
        WHERE id = ?
        """,
        (
            (code.strip().upper() if code else existing["code"]),
            (discount_type if discount_type is not None else existing["discount_type"]),
            (float(discount_value) if discount_value is not None else existing["discount_value"]),
            (max_uses if max_uses is not None else existing["max_uses"]),
            (expires_at if expires_at is not None else existing["expires_at"]),
            (min_purchase if min_purchase is not None else existing["min_purchase"]),
            (1 if active else 0) if active is not None else existing["active"],
            existing["id"],
        ),
    )
    _log_audit(admin["id"], "promotion_update", "promotion", existing["id"])
    return {"promotion": db.get("SELECT * FROM promotions WHERE id = ?", (existing["id"],))}


@router.delete("/promotions/{promo_id}")
def delete_promotion(promo_id: str, admin: dict = Depends(require_admin)):
    existing = db.get("SELECT * FROM promotions WHERE id = ?", (promo_id,))
    if not existing:
        raise HTTPException(status_code=404, detail={"error": "Promotion not found"})
    db.run("DELETE FROM promotions WHERE id = ?", (existing["id"],))
    _log_audit(admin["id"], "promotion_delete", "promotion", existing["id"])
    return {"success": True}
