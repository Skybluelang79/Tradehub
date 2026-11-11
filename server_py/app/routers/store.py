from fastapi import APIRouter, Depends, HTTPException

from .. import db
from ..deps import optional_user

router = APIRouter()

STORE_PROFILE = (
    "id, name, avatar, bio, verified, identity_verified, rating, review_count, "
    "location_address, created_at, store_slug, store_banner, store_description"
)


@router.get("/{slug}")
def get_store(slug: str, user: dict | None = Depends(optional_user)):
    slug = (slug or "").strip().lower()
    if not slug:
        raise HTTPException(status_code=404, detail={"error": "Store not found"})

    store = db.get(
        f"""
        SELECT {STORE_PROFILE}
        FROM users
        WHERE store_slug = ? AND COALESCE(status, 'active') NOT IN ('banned', 'suspended')
        """,
        (slug,),
    )
    if not store:
        raise HTTPException(status_code=404, detail={"error": "Store not found"})

    listings = db.all(
        """
        SELECT id, title, description, price, sale_price, condition, status, views,
               favorites, created_at
        FROM items WHERE seller_id = ? AND status = 'active'
        ORDER BY created_at DESC LIMIT 60
        """,
        (store["id"],),
    )
    for item in listings:
        images = db.all(
            "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1",
            (item["id"],),
        )
        item["images"] = [img["url"] for img in images]

    stats = db.get(
        """
        SELECT COUNT(*) AS total_listings,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_listings,
          SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) AS sold_listings
        FROM items WHERE seller_id = ?
        """,
        (store["id"],),
    ) or {}

    follower_count = db.get(
        "SELECT COUNT(*) AS count FROM follows WHERE following_id = ?", (store["id"],)
    )["count"]
    following_count = db.get(
        "SELECT COUNT(*) AS count FROM follows WHERE follower_id = ?", (store["id"],)
    )["count"]

    is_following = False
    if user:
        is_following = bool(
            db.get(
                "SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?",
                (user["id"], store["id"]),
            )
        )

    return {
        "user": store,
        "listings": listings,
        "stats": {
            "total_listings": stats.get("total_listings") or 0,
            "active_listings": stats.get("active_listings") or 0,
            "sold_listings": stats.get("sold_listings") or 0,
        },
        "followerCount": follower_count,
        "followingCount": following_count,
        "isFollowing": is_following,
    }
