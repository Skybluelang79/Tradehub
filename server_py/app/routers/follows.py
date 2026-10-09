import logging

from fastapi import APIRouter, Depends, HTTPException

from .. import config, db
from ..deps import optional_user, require_user
from ..notifications import notify

logger = logging.getLogger("tradehub")

router = APIRouter()


def _get_user_by_id(user_id):
    return db.get(
        "SELECT id, name, email, avatar, bio, verified, identity_verified, rating, review_count, created_at "
        "FROM users WHERE id = ?",
        (user_id,),
    )


def _follower_count(user_id):
    return db.get("SELECT COUNT(*) as count FROM follows WHERE following_id = ?", (user_id,))["count"]


def _following_count(user_id):
    return db.get("SELECT COUNT(*) as count FROM follows WHERE follower_id = ?", (user_id,))["count"]


@router.post("/{user_id}/follow")
def follow_user(user_id: str, user: dict = Depends(require_user)):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "You cannot follow yourself"})
    target = db.get("SELECT id FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})

    db.run("INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)", (user["id"], user_id))

    existing = db.get(
        "SELECT COUNT(*) as count FROM follows WHERE follower_id = ? AND following_id = ?",
        (user["id"], user_id),
    )
    if existing["count"]:
        target_user = _get_user_by_id(user_id)
        if target_user and target_user.get("email") and config.EMAIL_CONFIGURED:
            logger.info(
                "Follow email skipped (SMTP not configured): %s now following %s",
                user["name"],
                target_user["email"],
            )
    notify(target["id"], "follow", "New Follower", f"{user['name']} started following you.")

    return {"success": True, "followerCount": _follower_count(user_id), "isFollowing": True}


@router.delete("/{user_id}/follow")
def unfollow_user(user_id: str, user: dict = Depends(require_user)):
    db.run("DELETE FROM follows WHERE follower_id = ? AND following_id = ?", (user["id"], user_id))
    return {"success": True, "followerCount": _follower_count(user_id), "isFollowing": False}


@router.get("/status/{user_id}")
def follow_status(user_id: str, user: dict = Depends(require_user)):
    target = db.get("SELECT id FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    is_following = bool(db.get(
        "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?", (user["id"], user_id)
    ))
    return {
        "isFollowing": is_following,
        "followerCount": _follower_count(user_id),
        "followingCount": _following_count(user_id),
    }


@router.get("/counts/{user_id}")
def follow_counts(user_id: str):
    target = db.get("SELECT id FROM users WHERE id = ?", (user_id,))
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})
    return {"followerCount": _follower_count(user_id), "followingCount": _following_count(user_id)}


@router.get("/following")
def list_following(user: dict = Depends(require_user)):
    rows = db.all(
        "SELECT f.following_id as id, u.name, u.avatar, u.bio, u.verified, u.rating, u.review_count, "
        "f.created_at as followed_at "
        "FROM follows f JOIN users u ON u.id = f.following_id "
        "WHERE f.follower_id = ? ORDER BY f.created_at DESC",
        (user["id"],),
    )
    for row in rows:
        row["follower_count"] = _follower_count(row["id"])
        row["following_count"] = _following_count(row["id"])
    return {"following": rows}


@router.get("/followers")
def list_followers(user: dict = Depends(require_user)):
    rows = db.all(
        "SELECT f.follower_id as id, u.name, u.avatar, u.bio, u.verified, u.rating, u.review_count, "
        "f.created_at as followed_at "
        "FROM follows f JOIN users u ON u.id = f.follower_id "
        "WHERE f.following_id = ? ORDER BY f.created_at DESC",
        (user["id"],),
    )
    for row in rows:
        row["follower_count"] = _follower_count(row["id"])
        row["following_count"] = _following_count(row["id"])
    return {"followers": rows}


@router.get("/storefront/{user_id}")
def storefront(user_id: str, user: dict | None = Depends(optional_user)):
    target = db.get(
        "SELECT id, name, avatar, bio, phone, verified, identity_verified, rating, review_count, "
        "location_address, created_at FROM users WHERE id = ?",
        (user_id,),
    )
    if not target:
        raise HTTPException(status_code=404, detail={"error": "User not found"})

    listings = db.all(
        "SELECT id, title, description, price, sale_price, condition, status, views, favorites, created_at "
        "FROM items WHERE seller_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 60",
        (user_id,),
    )
    for item in listings:
        img = db.get(
            "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1", (item["id"],)
        )
        item["images"] = [img["url"]] if img else []

    stats = db.get(
        "SELECT COUNT(*) as total_listings, "
        "SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_listings, "
        "SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_listings "
        "FROM items WHERE seller_id = ?",
        (user_id,),
    )

    is_following = bool(user) and bool(db.get(
        "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?", (user["id"], user_id)
    ))

    return {
        "user": target,
        "listings": listings,
        "stats": {
            "total_listings": stats["total_listings"] or 0,
            "active_listings": stats["active_listings"] or 0,
            "sold_listings": stats["sold_listings"] or 0,
        },
        "followerCount": _follower_count(user_id),
        "followingCount": _following_count(user_id),
        "isFollowing": is_following,
    }