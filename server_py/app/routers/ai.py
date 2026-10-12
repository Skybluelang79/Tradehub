import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from .. import ai, db
from ..deps import optional_user, require_user

logger = logging.getLogger("tradehub")

router = APIRouter()


@router.post("/listing")
async def ai_listing(body: dict | None = Body(None), user: dict = Depends(require_user)):
    data = body or {}
    title = data.get("title") or ""
    description = data.get("description") or ""
    category = data.get("category") or ""
    condition = data.get("condition") or ""
    image_hints = data.get("imageHints") or ""

    if not str(title).strip() and not category:
        raise HTTPException(status_code=400, detail={"error": "Enter a title or category first"})

    try:
        return await ai.generate_listing(
            title=title,
            description=description,
            category=category,
            condition=condition,
            imageHints=image_hints,
        )
    except Exception:
        logger.error("AI listing generation error:", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "AI listing generation failed"})


@router.post("/parse")
async def ai_parse(body: dict | None = Body(None)):
    data = body or {}
    query = data.get("query") or ""

    if not str(query).strip():
        raise HTTPException(status_code=400, detail={"error": "Search query is required"})

    try:
        return await ai.parse_search(query)
    except Exception:
        logger.error("AI search parse error:", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "AI search failed"})


@router.post("/question")
async def ai_question(body: dict | None = Body(None), user: dict | None = Depends(optional_user)):
    data = body or {}
    item_id = data.get("itemId")
    question = data.get("question") or ""

    if not item_id:
        raise HTTPException(status_code=400, detail={"error": "itemId is required"})
    if not str(question).strip():
        raise HTTPException(status_code=400, detail={"error": "Question is required"})

    try:
        row = db.get(
            "SELECT i.*, u.name AS seller_name "
            "FROM items i LEFT JOIN users u ON u.id = i.seller_id "
            "WHERE i.id = ?",
            (item_id,),
        )
        if not row:
            raise HTTPException(status_code=404, detail={"error": "Item not found"})

        answer = await ai.answer_listing_question(
            item=row, sellerName=row.get("seller_name") or "", question=question
        )
        return {"answer": answer}
    except HTTPException:
        raise
    except Exception:
        logger.error("AI question error:", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "AI question failed"})


@router.post("/price-guide")
async def ai_price_guide(body: dict | None = Body(None), user: dict | None = Depends(optional_user)):
    data = body or {}
    item_id = data.get("itemId")
    category = data.get("category")
    price = data.get("price")
    title = data.get("title")

    try:
        if item_id:
            row = db.get(
                "SELECT id, title, price, category FROM items WHERE id = ?", (item_id,)
            )
            if not row:
                raise HTTPException(status_code=404, detail={"error": "Item not found"})
            return ai.price_guide(
                category=row["category"],
                price=row["price"],
                title=row["title"],
                excludeId=row["id"],
            )
        return ai.price_guide(category=category, price=price, title=title)
    except HTTPException:
        raise
    except Exception:
        logger.error("AI price guide error:", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "AI price guide failed"})


@router.get("/recommendations")
async def ai_recommendations(
    item_id: str | None = Query(None, alias="itemId"),
    limit: str | None = Query(None),
    user: dict | None = Depends(optional_user),
):
    try:
        result = await ai.recommendations(
            userId=user["id"] if user else "",
            itemId=str(item_id or ""),
            limit=limit,
        )
        return {"items": result}
    except Exception:
        logger.error("AI recommendations error:", exc_info=True)
        raise HTTPException(status_code=500, detail={"error": "AI recommendations failed"})
