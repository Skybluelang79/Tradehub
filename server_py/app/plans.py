from .datetime_util import parse_iso, utc_now

GOLD_PRICE_USD = 9.99

PLANS = {
    "free": {
        "name": "Free",
        "price": 0,
        "priceUsd": 0,
        "fee": 0.04,
        "boosts": 0,
        "maxListings": 30,
        "maxPhotos": 6,
        "maxVideos": 0,
        "listingDays": 30,
        "featuredSlots": 0,
        "auctionAutoApprove": False,
        "analytics": False,
        "distressPinned": False,
        "badge": None,
    },
    "premium": {
        "name": "Gold",
        "price": GOLD_PRICE_USD,
        "priceUsd": GOLD_PRICE_USD,
        "fee": 0.02,
        "boosts": 7,
        "maxListings": 120,
        "maxPhotos": 10,
        "maxVideos": 1,
        "listingDays": 90,
        "featuredSlots": 7,
        "auctionAutoApprove": True,
        "analytics": True,
        "distressPinned": True,
        "badge": "Gold Seller",
    },
    "pro": {
        "name": "Pro",
        "price": 24.99,
        "priceUsd": 24.99,
        "fee": 0.02,
        "boosts": 7,
        "maxListings": -1,
        "maxPhotos": 10,
        "maxVideos": 1,
        "listingDays": 90,
        "featuredSlots": 7,
        "auctionAutoApprove": True,
        "analytics": True,
        "distressPinned": True,
        "badge": "Pro Seller",
    },
}


def get_plan(plan_id):
    return PLANS.get(plan_id) or PLANS["free"]


def is_paid_plan(plan_id):
    return plan_id != "free" and plan_id in PLANS


def get_effective_plan(sub):
    if not sub:
        return "free"
    plan = sub.get("plan")
    if not plan or plan not in PLANS or plan == "free":
        return "free"
    if sub.get("status") == "trial":
        trial_end = parse_iso(sub.get("trial_end"))
        return plan if trial_end and trial_end > utc_now() else "free"
    if sub.get("status") != "active":
        return "free"
    period_end = parse_iso(sub.get("current_period_end"))
    if period_end and period_end <= utc_now():
        return "free"
    return plan
