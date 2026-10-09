import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import db
from ..deps import require_user
from ..notifications import notify

logger = logging.getLogger("tradehub")

router = APIRouter()


@router.get("/user/{user_id}")
def get_user_reviews(user_id: str):
    reviews = db.all(
        "SELECT r.*, u.name as reviewer_name, u.avatar as reviewer_avatar "
        "FROM reviews r JOIN users u ON r.reviewer_id = u.id "
        "WHERE r.reviewee_id = ? ORDER BY r.created_at DESC",
        (user_id,),
    )
    return {"reviews": reviews}


@router.post("", status_code=201)
def create_review(
    body: dict = Body(...),
    user: dict = Depends(require_user),
):
    reviewee_id = body.get("revieweeId")
    item_id = body.get("itemId")
    rating = body.get("rating")
    text = body.get("text", "")

    if not reviewee_id or rating is None:
        raise HTTPException(status_code=400, detail={"error": "revieweeId and rating are required"})

    if not isinstance(rating, int) or isinstance(rating, bool) or rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail={"error": "Rating must be between 1 and 5"})

    if reviewee_id == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Cannot review yourself"})

    completed_txn = db.get(
        "SELECT id, item_id FROM transactions "
        "WHERE status = 'completed' AND ((buyer_id = ? AND seller_id = ?) OR (buyer_id = ? AND seller_id = ?))",
        (user["id"], reviewee_id, reviewee_id, user["id"]),
    )
    if not completed_txn:
        raise HTTPException(
            status_code=403,
            detail={"error": "You can only review a user after a completed transaction"},
        )

    verified = 0
    if item_id:
        item_txn = db.get(
            "SELECT id FROM transactions "
            "WHERE status = 'completed' AND item_id = ? AND buyer_id = ? AND seller_id = ?",
            (item_id, user["id"], reviewee_id),
        )
        verified = 1 if item_txn else 0

    review_id = str(uuid.uuid4())
    db.run(
        "INSERT INTO reviews (id, reviewer_id, reviewee_id, item_id, rating, text, verified) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (review_id, user["id"], reviewee_id, item_id or None, rating, str(text or "")[:1000], verified),
    )

    reviews = db.get(
        "SELECT AVG(rating) as avg, COUNT(*) as count FROM reviews WHERE reviewee_id = ?",
        (reviewee_id,),
    )
    new_rating = round((reviews["avg"] or 0) * 10) / 10
    db.run(
        "UPDATE users SET rating = ?, review_count = ? WHERE id = ?",
        (new_rating, reviews["count"], reviewee_id),
    )

    notify(reviewee_id, "review", "New Review", f"{user['name']} left you a {rating}-star review.")

    review = db.get(
        "SELECT r.*, u.name as reviewer_name, u.avatar as reviewer_avatar "
        "FROM reviews r JOIN users u ON r.reviewer_id = u.id WHERE r.id = ?",
        (review_id,),
    )
    return {"review": review}