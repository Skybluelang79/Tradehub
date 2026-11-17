import json as _json
import math
import os
import re

import httpx

from . import db

KNOWN_CATEGORIES = [
    "electronics",
    "fashion",
    "gaming",
    "furniture",
    "sports",
    "books",
    "home",
    "vehicles",
    "other",
]

CATEGORY_KEYWORDS = {
    "electronics": [
        "phone", "laptop", "computer", "camera", "headphone", "headset", "earbud",
        "tablet", "tv", "speaker", "console", "keyboard", "router", "drone", "tech",
    ],
    "fashion": [
        "shirt", "dress", "jacket", "shoe", "sneaker", "bag", "watch", "jeans",
        "hoodie", "sweater", "coat", "hat", "clothing",
    ],
    "gaming": [
        "nintendo", "playstation", "ps4", "ps5", "xbox", "game", "console", "switch", "gaming",
    ],
    "furniture": [
        "sofa", "table", "chair", "desk", "bed", "shelf", "cabinet", "dresser", "couch", "lamp",
    ],
    "sports": [
        "bike", "bicycle", "ball", "gym", "yoga", "fitness", "dumbbell", "skate", "racket", "weight",
    ],
    "books": ["book", "novel", "textbook"],
    "home": ["pan", "kitchen", "vacuum", "blender", "towel", "decor", "plant", "garden", "mug"],
    "vehicles": ["car", "truck", "motorcycle", "bike", "scooter", "atv"],
}

AUTO_DESCRIPTIONS = {
    "electronics": "In excellent working condition. Fully tested and functioning properly. Includes all original accessories and packaging. Minor signs of normal use.",
    "fashion": "Gently used item in great condition. Clean and well-maintained. No stains, tears, or significant wear. True to size. Perfect for everyday wear or special occasions.",
    "gaming": "Well-maintained and fully functional. Tested and working perfectly. Includes all cables and accessories. Minor cosmetic wear from normal use. Smoke-free environment.",
    "furniture": "Used but in great condition. Sturdy and structurally sound. Minor cosmetic wear consistent with normal use. Clean and ready for immediate use. Local pickup preferred.",
    "sports": "Used but well-maintained. Clean and in good working order. No major damage or defects. Ready for use. Price reflects normal wear and tear from regular use.",
    "books": "Used book in good condition. Pages are clean with no marking or highlighting. Cover shows minor wear. No missing pages. Great condition for the price.",
    "home": "Gently used item in good condition. Clean and well-cared for. No major defects or damage functions as intended. Ready to use in your home.",
    "vehicles": "Well-maintained and in good running condition. Regular maintenance performed. Clean title. No major mechanical issues. Available for inspection and test drive.",
    "other": "Used item in good condition. Clean and fully functional. Well-cared for and ready to use. Please see photos for details on condition.",
}

CONDITION_LABELS = {"new": "new", "like_new": "like new", "good": "good", "fair": "fair"}


AI_PROVIDERS = ["openai", "openai-compatible", "anthropic", "google"]

AI_PROMPT_DEFAULTS = {
    "listing": (
        "You are a marketplace listing copywriter. Write a compelling, honest secondhand listing. "
        "Respond with valid JSON ONLY, no prose, using this exact shape: "
        '{"title": string, "description": string (2-4 sentences, no emojis), "price": number|null}. '
        "Give a single integer price in Nigerian naira (NGN). If you cannot estimate a price, set price to null."
    ),
    "search": (
        "You parse marketplace search phrases into filters. Respond with valid JSON ONLY: "
        '{"category": string (one of: {{categories}}, or "" if none), '
        '"minPrice": number|null, "maxPrice": number|null, "query": string (the cleaned, non-numeric keywords)}. '
        "Only set minPrice/maxPrice when the phrase clearly states a budget."
    ),
    "question": (
        "You are a helpful, honest assistant answering a buyer question about a listing on TradeHub, "
        "a local buy-and-sell marketplace with escrow-protected payments. "
        "Answer in 2-4 short sentences. Be friendly, factual, and never invent details not present in the listing. "
        "If the question is about buying/shipping/meeting, suggest the buyer message the seller or check out via escrow."
    ),
}

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "openai-compatible": "gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "google": "gemini-1.5-flash",
}


def _setting_value(key, default=""):
    try:
        row = db.get("SELECT value FROM platform_settings WHERE key = ?", (key,))
        if row and row.get("value") is not None:
            return str(row["value"])
    except Exception:
        pass
    return default


def _normalize_provider(value):
    raw = str(value or "").strip().lower()
    aliases = {
        "compatible": "openai-compatible",
        "custom": "openai-compatible",
        "gemini": "google",
        "google-gemini": "google",
        "claude": "anthropic",
    }
    provider = aliases.get(raw, raw)
    return provider if provider in AI_PROVIDERS else "openai"


def _env_api_key(provider):
    by_provider = {
        "openai": os.environ.get("OPENAI_API_KEY"),
        "openai-compatible": os.environ.get("AI_API_KEY"),
        "anthropic": os.environ.get("ANTHROPIC_API_KEY"),
        "google": os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY"),
    }
    return str(by_provider.get(provider) or os.environ.get("AI_API_KEY") or "").strip()


def _env_base_url(provider):
    by_provider = {
        "openai": os.environ.get("OPENAI_BASE_URL"),
        "openai-compatible": os.environ.get("AI_BASE_URL"),
        "anthropic": os.environ.get("ANTHROPIC_BASE_URL"),
        "google": os.environ.get("GOOGLE_BASE_URL"),
    }
    return str(by_provider.get(provider) or os.environ.get("AI_BASE_URL") or "").strip()


def ai_config():
    provider = _normalize_provider(_setting_value("ai_provider", os.environ.get("AI_PROVIDER") or "openai"))
    stored_key = _setting_value("ai_api_key", "").strip()
    fallback_key = _env_api_key(provider)
    return {
        "enabled": _setting_value("ai_enabled", "1") != "0",
        "provider": provider,
        "model": _setting_value("ai_model", "").strip() or os.environ.get("AI_MODEL") or DEFAULT_MODELS[provider],
        "baseUrl": _setting_value("ai_base_url", "").strip() or _env_base_url(provider),
        "apiKey": stored_key or fallback_key,
        "apiKeySource": "database" if stored_key else "environment" if fallback_key else "none",
    }


def has_llm():
    config = ai_config()
    return config["enabled"] and bool(config["apiKey"])


def prompt_for(setting_key, default_key, known_categories=None):
    known_categories = known_categories or KNOWN_CATEGORIES
    prompt = _setting_value(setting_key, "").strip() or AI_PROMPT_DEFAULTS[default_key]
    return prompt.replace("{{categories}}", ", ".join(known_categories))


def _trim_base_url(base_url, fallback):
    return str(base_url or fallback).rstrip("/")


def _parse_json_content(content):
    if not isinstance(content, str):
        return None
    try:
        return _json.loads(content)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", content)
        if not match:
            return None
        try:
            return _json.loads(match.group(0))
        except Exception:
            return None


async def _call_openai_compatible(client, config, messages, json, max_tokens, temperature):
    base = _trim_base_url(config["baseUrl"], "https://api.openai.com/v1")
    endpoint = base if re.search(r"/chat/completions$", base, re.I) else f"{base}/chat/completions"
    body = {
        "model": config["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json:
        body["response_format"] = {"type": "json_object"}
    res = await client.post(
        endpoint,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {config['apiKey']}"},
        json=body,
    )
    if not (200 <= res.status_code < 300):
        return None
    try:
        data = res.json()
    except Exception:
        return None
    return ((data.get("choices") or [{}])[0].get("message") or {}).get("content")


async def _call_anthropic(client, config, messages, max_tokens, temperature):
    base = _trim_base_url(config["baseUrl"], "https://api.anthropic.com/v1")
    endpoint = base if re.search(r"/messages$", base, re.I) else f"{base}/messages"
    system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
    body = {
        "model": config["model"],
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [
            {"role": "assistant" if m.get("role") == "assistant" else "user", "content": m["content"]}
            for m in messages
            if m.get("role") != "system"
        ],
    }
    if system:
        body["system"] = system
    res = await client.post(
        endpoint,
        headers={
            "Content-Type": "application/json",
            "x-api-key": config["apiKey"],
            "anthropic-version": "2023-06-01",
        },
        json=body,
    )
    if not (200 <= res.status_code < 300):
        return None
    try:
        data = res.json()
    except Exception:
        return None
    parts = data.get("content") if isinstance(data, dict) else None
    if not isinstance(parts, list):
        return None
    return "".join(part.get("text", "") for part in parts if part.get("type") == "text") or None


async def _call_google(client, config, messages, json, max_tokens, temperature):
    base = _trim_base_url(config["baseUrl"], "https://generativelanguage.googleapis.com/v1beta")
    endpoint = f"{base}/models/{config['model']}:generateContent"
    system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
    generation_config = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if json:
        generation_config["responseMimeType"] = "application/json"
    body = {
        "contents": [
            {
                "role": "model" if m.get("role") == "assistant" else "user",
                "parts": [{"text": m["content"]}],
            }
            for m in messages
            if m.get("role") != "system"
        ],
        "generationConfig": generation_config,
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    res = await client.post(
        endpoint,
        headers={"Content-Type": "application/json", "x-goog-api-key": config["apiKey"]},
        json=body,
    )
    if not (200 <= res.status_code < 300):
        return None
    try:
        data = res.json()
    except Exception:
        return None
    candidates = data.get("candidates") if isinstance(data, dict) else None
    if not isinstance(candidates, list) or not candidates:
        return None
    parts = ((candidates[0].get("content") or {}).get("parts") or [])
    return "".join(part.get("text", "") for part in parts) or None


def _to_number(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _js_round(value):
    return math.floor(value + 0.5)


def _norm_num(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _locale_number(value):
    n = _to_number(value)
    if n is None or not math.isfinite(n):
        return "NaN"
    if n == int(n):
        return f"{int(n):,}"
    return f"{n:,}"


async def llm(messages, json=False, maxTokens=500, temperature=0.6):
    config = ai_config()
    if not config["enabled"] or not config["apiKey"]:
        return None
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if config["provider"] == "anthropic":
                content = await _call_anthropic(client, config, messages, maxTokens, temperature)
            elif config["provider"] == "google":
                content = await _call_google(client, config, messages, json, maxTokens, temperature)
            else:
                content = await _call_openai_compatible(client, config, messages, json, maxTokens, temperature)
        if not isinstance(content, str) or not content.strip():
            return None
        return _parse_json_content(content) if json else content.strip()
    except Exception:
        return None


def clamp_price(value):
    n = _to_number(value)
    if n is None or not math.isfinite(n) or n <= 0:
        return None
    return _norm_num(_js_round(n * 100) / 100)


def similar_stats(category, excludeIds=None, title=""):
    exclusions = []
    raw = excludeIds if isinstance(excludeIds, (list, tuple)) else [excludeIds]
    for x in raw:
        if x:
            exclusions.append(x)
    placeholders = ", ".join(["?"] * len(exclusions))
    params = []
    rows = []

    if title:
        tokens = [t for t in str(title).split() if len(t) > 2][:3]
        if tokens:
            like_parts = " OR ".join(["title LIKE ?"] * len(tokens))
            params.extend([f"%{t}%" for t in tokens])
            if exclusions:
                params.extend(exclusions)
                rows = db.all(
                    f"SELECT title, price FROM items WHERE ({like_parts}) AND status = 'active' "
                    f"AND price > 0 AND id NOT IN ({placeholders}) LIMIT 30",
                    tuple(params),
                )
            else:
                rows = db.all(
                    f"SELECT title, price FROM items WHERE ({like_parts}) AND status = 'active' "
                    f"AND price > 0 LIMIT 30",
                    tuple(params),
                )

    if len(rows) < 3 and category and category != "all":
        cat_params = [category]
        sql = "SELECT title, price FROM items WHERE category = ? AND status = 'active' AND price > 0"
        if exclusions:
            cat_params.extend(exclusions)
            sql += f" AND id NOT IN ({placeholders})"
        sql += " LIMIT 30"
        rows = db.all(sql, tuple(cat_params))

    if len(rows) < 2:
        return None

    prices = sorted(r["price"] for r in rows)
    mid = len(prices) // 2
    if len(prices) % 2:
        median = prices[mid]
    else:
        median = (prices[mid - 1] + prices[mid]) / 2
    avg = sum(prices) / len(prices)
    return {
        "count": len(rows),
        "avg": _norm_num(_js_round(avg * 100) / 100),
        "median": _norm_num(_js_round(median * 100) / 100),
        "min": _norm_num(prices[0]),
        "max": _norm_num(prices[-1]),
    }


async def generate_listing(title="", description="", category="", condition="", imageHints=""):
    stats = similar_stats(category, title=title)
    user_content = (
        f'Title so far: "{title or "(not given)"}"\n'
        f"Category: {category or 'other'}\n"
        f"Condition: {condition or 'good'}\n"
        f'Existing description: "{description or "(empty)"}"'
    )
    if imageHints:
        user_content += f"\nVisual hints: {imageHints}"
    if stats:
        user_content += (
            f"\nMarket reference for the category: median ₦{stats['median']}, "
            f"range ₦{stats['min']}-₦{stats['max']} across {stats['count']} similar items."
        )

    ai_data = await llm(
        [
            {"role": "system", "content": prompt_for("ai_prompt_listing", "listing")},
            {"role": "user", "content": user_content},
        ],
        json=True,
        maxTokens=400,
    )

    if ai_data and (ai_data.get("title") or ai_data.get("description")):
        return {
            "title": str(ai_data.get("title") or title)[:120],
            "description": str(ai_data.get("description") or description)[:3000],
            "price": clamp_price(ai_data.get("price")),
        }

    cat_key = category if category in KNOWN_CATEGORIES else "other"
    fallback_desc = description or f'"{title}" - {AUTO_DESCRIPTIONS[cat_key]}'
    return {
        "title": str(title)[:120],
        "description": str(fallback_desc)[:3000],
        "price": clamp_price(stats["median"]) if stats else None,
    }


async def parse_search(query="", knownCategories=KNOWN_CATEGORIES):
    ai_data = await llm(
        [
            {"role": "system", "content": prompt_for("ai_prompt_search", "search", knownCategories)},
            {"role": "user", "content": f'Search phrase: "{query}"'},
        ],
        json=True,
        maxTokens=200,
    )

    if ai_data:
        category = ""
        if ai_data.get("category") and ai_data.get("category") in knownCategories:
            category = ai_data.get("category")
        if not category:
            lower = str(ai_data.get("query") or query).lower()
            for cat, words in CATEGORY_KEYWORDS.items():
                if any(w in lower for w in words):
                    category = cat
                    break
        return {
            "category": category,
            "minPrice": clamp_price(ai_data.get("minPrice")) or "",
            "maxPrice": clamp_price(ai_data.get("maxPrice")) or "",
            "query": str(ai_data.get("query") or query).strip()[:120],
        }

    lower = str(query).lower()
    category = ""
    for cat, words in CATEGORY_KEYWORDS.items():
        if any(w in lower for w in words):
            category = cat
            break
    min_price = ""
    max_price = ""
    range_match = re.search(r"(?:\$)?(\d+)\s*[-–to]+\s*(?:\$)?(\d+)", lower)
    if range_match:
        min_price = clamp_price(range_match.group(1)) or ""
        max_price = clamp_price(range_match.group(2)) or ""
    else:
        under = re.search(r"(?:under|below|less than|max|up to|within)\s*(?:\$)?\s*(\d+)", lower)
        over = re.search(r"(?:over|above|more than|from|min)\s*(?:\$)?\s*(\d+)", lower)
        if under:
            max_price = clamp_price(under.group(1)) or ""
        if over:
            min_price = clamp_price(over.group(1)) or ""
    cleaned = re.sub(
        r"under|below|less than|over|above|more than|from|up to|max|min|within|\$|\d+",
        " ",
        query,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return {"category": category, "minPrice": min_price, "maxPrice": max_price, "query": cleaned[:120]}


async def answer_listing_question(item=None, sellerName="", question=""):
    if not item or not item.get("title"):
        return "Sorry, this listing could not be found."
    ai_data = await llm(
        [
            {"role": "system", "content": prompt_for("ai_prompt_question", "question")},
            {
                "role": "user",
                "content": (
                    f"Item: {item['title']}\nPrice: ₦{item.get('price')}"
                    f"{f' (on sale: ₦{item.get('sale_price')})' if item.get('sale_price') else ''}\n"
                    f"Condition: {CONDITION_LABELS.get(item.get('condition')) or item.get('condition') or 'good'}\n"
                    f"Location: {item.get('location_address') or 'local'}\n"
                    f"Seller: {sellerName or 'a local seller'}\n"
                    f"Description: {str(item.get('description') or '')[:600]}\n"
                    f"---\nBuyer question: {question}"
                ),
            },
        ],
        maxTokens=220,
        temperature=0.4,
    )

    if ai_data:
        return ai_data

    q = str(question).lower()
    if re.search(r"(still )?available|in stock|is this item", q, re.IGNORECASE):
        return (
            f'Yes — "{item["title"]}" is an active listing and should be available to buy. '
            "You can check out securely through TradeHub's escrow, which only releases payment once you confirm the item."
        )
    if re.search(r"condition|damage|scratch|defect|used", q, re.IGNORECASE):
        return (
            f"The item is listed in {CONDITION_LABELS.get(item.get('condition')) or item.get('condition') or 'good'} condition. "
            f"{str(item.get('description') or '')[:200]} For precise details, send the seller a message from this listing."
        )
    if re.search(r"price|negotiate|discount|offer|cheaper|deal", q):
        return (
            f"The listed price is ₦{_locale_number(item.get('price'))}. You can make an offer through the app — "
            "the seller can accept, decline, or counter. Escrow keeps your money safe until the item is delivered to your satisfaction."
        )
    if re.search(r"ship|delivery|mail|deliver|post", q):
        return (
            "Shipping availability depends on the seller. Use the message button to ask about delivery options — "
            "if you agree on terms, TradeHub escrow protects your payment until the deal is completed."
        )
    if re.search(r"meet|pickup|location|where", q):
        return (
            f"This item is listed near {item.get('location_address') or 'the seller'}. Reach out to the seller to arrange "
            "a local meetup — and check the safe-trading tips in the app before meeting."
        )
    return (
        f'"{item["title"]}" is listed for ₦{_locale_number(item.get("price"))} in '
        f"{CONDITION_LABELS.get(item.get('condition')) or 'good'} condition. For anything specific, the best next step "
        "is to message the seller through the app — every TradeHub transaction is protected by escrow."
    )


def price_guide(category="other", price=None, title="", excludeId=""):
    stats = similar_stats(category, excludeIds=[excludeId] if excludeId else [], title=title or "")
    p = clamp_price(price)

    if not stats:
        if p:
            advice = (
                f"Not enough similar listings to compare yet. At ₦{_locale_number(p)}, pricing ~10% above or below "
                "similar new-in-category items is a safe starting point."
            )
        else:
            advice = (
                "Not enough similar listings to compare yet. Check what similar items sell for nearby, then set a fair price."
            )
        return {"stats": None, "advice": advice}

    range_str = f"₦{_locale_number(stats['min'])} – ₦{_locale_number(stats['max'])}"
    if not p:
        advice = (
            f"Similar items range {range_str} (median ₦{_locale_number(stats['median'])}, "
            f"avg ₦{_locale_number(stats['avg'])}). Listing around the median is your best shot at a quick sale."
        )
    else:
        diff = _js_round(((p - stats["median"]) / stats["median"]) * 100)
        closeness = abs(diff) if stats["median"] > 0 else 100
        if closeness <= 10:
            advice = (
                f"Your ₦{_locale_number(p)} is right in line with {stats['count']} similar items "
                f"(median ₦{_locale_number(stats['median'])}). Fairly priced."
            )
        elif diff < 0:
            advice = (
                f"Your ₦{_locale_number(p)} is ~{abs(diff)}% below the median ₦{_locale_number(stats['median'])} — "
                f"priced to sell fast. Consider ₦{_locale_number(stats['median'])} if you want top value."
            )
        else:
            advice = (
                f"Your ₦{_locale_number(p)} is ~{diff}% above the median ₦{_locale_number(stats['median'])}. "
                f"You may need to negotiate; a sweet spot is around ₦{_locale_number(stats['median'])} (range {range_str})."
            )
    return {"stats": {**stats, "range": range_str}, "advice": advice}


async def recommendations(userId="", itemId="", limit=6):
    n = _to_number(limit)
    if n is None or n == 0:
        n = 6
    take = int(min(max(n, 1), 20))

    rows = []
    params = []
    excluded = []

    if itemId:
        base = db.get("SELECT id, category, price FROM items WHERE id = ?", (itemId,))
        if base:
            excluded.append(base["id"])
            rows = db.all(
                "SELECT * FROM items WHERE status = 'active' AND category = ? AND id != ? AND price > 0 "
                "ORDER BY ABS(price - ?) ASC, favorites DESC LIMIT ?",
                (base["category"], base["id"], base["price"] or 0, take),
            )

    if len(rows) == 0:
        if userId and userId != "currentUserId":
            excluded.append(userId)
        excl = [x for x in excluded if x]
        placeholders = ", ".join(["?"] * len(excl))
        sql = "SELECT * FROM items WHERE status = 'active' AND price > 0"
        cat_params = list(params)
        if excl:
            sql += f" AND seller_id NOT IN ({placeholders})"
        sql += (
            " ORDER BY CASE WHEN boosted = 1 THEN 0 ELSE 1 END, favorites DESC, views DESC, "
            "created_at DESC LIMIT ?"
        )
        rows = db.all(sql, tuple([*cat_params, *excl, take]))

    return [serialize_item(row) for row in rows]


def serialize_item(row):
    images = db.all(
        "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order, id", (row["id"],)
    )
    return {**row, "images": [i["url"] for i in images]}


hasLLM = has_llm
similarStats = similar_stats
generateListing = generate_listing
parseSearch = parse_search
answerListingQuestion = answer_listing_question
priceGuide = price_guide
recommendations = recommendations
serializeItem = serialize_item
