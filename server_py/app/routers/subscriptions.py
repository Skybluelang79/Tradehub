import json
import logging
import math
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import config, db
from ..currencies import DEFAULT_CURRENCY
from ..datetime_util import parse_iso, utc_now
from ..deps import require_user
from ..notifications import notify
from ..paystack import (
    PAYSTACK_PUBLIC_KEY,
    PaystackError,
    is_paystack_configured,
    paystack,
    to_minor_units,
)

logger = logging.getLogger("tradehub")

router = APIRouter()

# Flat 4% seller fee on every plan. `fee` here is what the plan/benefit
# screens display, so it has to match PLAN_FEES in payments.py.
PLANS = {
    "free": {"name": "Free", "price": 0, "fee": 0.04, "boosts": 0, "maxListings": 5, "badge": None},
    "premium": {
        "name": "Premium",
        "price": 3000,
        "fee": 0.04,
        "boosts": 2,
        "maxListings": -1,
        "badge": "Premium Seller",
    },
    "pro": {
        "name": "Pro",
        "price": 24.99,
        "fee": 0.04,
        "boosts": 5,
        "maxListings": -1,
        "badge": "Pro Seller",
    },
}

IS_PROD = config.IS_PRODUCTION


def get_subscription(user_id):
    sub = db.get("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,))
    if not sub:
        sub_id = str(uuid.uuid4())
        db.run(
            "INSERT INTO subscriptions (id, user_id, plan, status, trial_end) "
            "VALUES (?, ?, 'free', 'active', null)",
            (sub_id, user_id),
        )
        sub = db.get("SELECT * FROM subscriptions WHERE user_id = ?", (user_id,))
    return sub


def _is_active_trial(sub):
    if sub.get("status") != "trial" or not sub.get("trial_end"):
        return False
    parsed = parse_iso(sub["trial_end"])
    return bool(parsed and parsed > utc_now())


# Idempotent plan activation used by both the verify route and the
# `charge.success` webhook after a successful Paystack payment. When Paystack
# returns subscription identifiers we persist them so later
# subscription.disable / not_renew webhooks can find this row.
def activate_plan(user_id, plan, info=None):
    info = info or {}
    if plan not in PLANS:
        return False
    sub = get_subscription(user_id)
    db.run(
        """
        UPDATE subscriptions SET plan = ?, status = 'active',
          current_period_start = datetime('now'),
          current_period_end = datetime('now', '+30 days'),
          trial_end = NULL,
          pending_plan = NULL,
          paystack_reference = NULL,
          paystack_subscription_code = COALESCE(?, paystack_subscription_code),
          paystack_email_token = COALESCE(?, paystack_email_token),
          updated_at = datetime('now')
        WHERE user_id = ?
        """,
        (plan, info.get("subscriptionCode") or None, info.get("emailToken") or None, user_id),
    )
    if not sub or sub.get("plan") != plan:
        notify(user_id, "system", "Plan Upgraded", f"You're now on the {PLANS[plan]['name']} plan!")
    return True


# ---------------------------------------------------------------------------
# Recurring billing: Paystack plans
# ---------------------------------------------------------------------------
# A Paystack "plan" is the server-side template that drives automatic monthly
# charges. We create one per paid tier (lazily) and cache the returned
# `plan_code` in platform_settings so every checkout reuses the same plan.
# Passing that code to transaction/initialize makes Paystack set up the
# subscription automatically on the first successful charge.


def read_plan_codes():
    row = db.get("SELECT value FROM platform_settings WHERE key = 'paystack_plan_codes'")
    if not row or not row.get("value"):
        return {}
    try:
        parsed = json.loads(row["value"])
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def write_plan_codes(mapping):
    db.run(
        """
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ('paystack_plan_codes', ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        """,
        (json.dumps(mapping),),
    )


def get_paystack_plan_code(plan_id):
    plan = PLANS.get(plan_id)
    if not plan or plan["price"] <= 0 or not is_paystack_configured():
        return None
    cache_key = f"{plan_id}:{DEFAULT_CURRENCY}"
    codes = read_plan_codes()
    if codes.get(cache_key):
        return codes[cache_key]

    created = paystack.create_plan(
        name=f"TradeHub {plan['name']}",
        amount_minor=to_minor_units(plan["price"], DEFAULT_CURRENCY),
        interval="monthly",
        currency=DEFAULT_CURRENCY,
    )
    code = (created or {}).get("plan_code") or (created or {}).get("code")
    if code:
        codes[cache_key] = code
        write_plan_codes(codes)
    return code or None


# Reverse-map a Paystack plan_code back to our tier id, for webhook handlers
# that only know the code.
def plan_id_for_code(code):
    if not code:
        return None
    codes = read_plan_codes()
    for cache_key, value in codes.items():
        if value == code:
            return cache_key.split(":")[0]
    return None


@router.get("/current")
def get_current(user: dict = Depends(require_user)):
    sub = get_subscription(user["id"])
    plan = PLANS.get(sub["plan"]) or PLANS["free"]
    is_trial = _is_active_trial(sub)
    days_left = 0
    if is_trial:
        parsed = parse_iso(sub["trial_end"])
        days_left = math.ceil((parsed - utc_now()).total_seconds() / (60 * 60 * 24))
    plan_details = {
        **sub,
        **plan,
        "fee": plan["fee"],
        "boosts": plan["boosts"],
        "maxListings": plan["maxListings"],
        "badge": plan["badge"],
        "isTrial": is_trial,
        "trialEndsAt": sub.get("trial_end"),
        "daysLeft": days_left,
    }
    return {"subscription": plan_details}


@router.get("/plans")
def get_plans():
    plans = [{"id": plan_id, **plan} for plan_id, plan in PLANS.items()]
    return {"plans": plans}


@router.post("/upgrade")
def upgrade(user: dict = Depends(require_user), body: dict = Body(...)):
    target_plan = body.get("plan")
    if not target_plan or target_plan not in PLANS:
        raise HTTPException(status_code=400, detail={"error": "Invalid plan"})

    sub = get_subscription(user["id"])
    if target_plan == sub["plan"]:
        raise HTTPException(status_code=400, detail={"error": f"Already on the {target_plan} plan"})

    # Paid plans require payment. In production we charge through Paystack and
    # activate the plan after the charge succeeds (webhook or verify call). In
    # development/demo mode a free upgrade is kept so the feature can still be
    # demonstrated without a configured gateway.
    is_paid = PLANS[target_plan]["price"] > 0
    if is_paid and IS_PROD:
        if not is_paystack_configured():
            raise HTTPException(
                status_code=503,
                detail={"error": "Paid subscriptions require Paystack to be configured"},
            )
        reference = str(uuid.uuid4())
        amount_minor = to_minor_units(PLANS[target_plan]["price"], DEFAULT_CURRENCY)
        # Passing the plan code turns this first charge into a recurring
        # subscription: Paystack auto-charges the buyer each month until it is
        # disabled via /cancel. If we can't mint a plan we fall back to a
        # one-off charge and the local 30-day period still applies.
        try:
            plan_code = get_paystack_plan_code(target_plan)
        except Exception as err:
            logger.warning("Could not create Paystack plan for %s: %s", target_plan, err)
            plan_code = None
        try:
            initialized = paystack.initialize_transaction(
                amount_minor=amount_minor,
                currency=DEFAULT_CURRENCY,
                email=user["email"],
                reference=reference,
                plan_code=plan_code,
                metadata={
                    "userId": user["id"],
                    "plan": target_plan,
                    "tradehub_subscription": reference,
                },
                callback_url=config.PAYSTACK_CALLBACK_URL,
            )
        except PaystackError as err:
            raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})

        # Remember which plan this reference is paying for so the frontend/webhook
        # can activate it idempotently.
        db.run(
            "UPDATE subscriptions SET pending_plan = ?, paystack_reference = ?, "
            "updated_at = datetime('now') WHERE user_id = ?",
            (target_plan, reference, user["id"]),
        )

        return {
            "requires_payment": True,
            "reference": reference,
            "accessCode": initialized.get("access_code"),
            "authorizationUrl": initialized.get("authorization_url"),
            "publicKey": PAYSTACK_PUBLIC_KEY,
            "currency": DEFAULT_CURRENCY,
        }

    activate_plan(user["id"], target_plan)

    updated = get_subscription(user["id"])
    plan = PLANS[updated["plan"]]
    return {"success": True, "subscription": {**updated, **plan}}


# Verifies a Paystack subscription payment after the Paystack Pop callback.
# Idempotent: the plan is only activated once per reference.
@router.get("/upgrade/verify/{reference}")
def verify_upgrade(reference: str, user: dict = Depends(require_user)):
    sub = db.get("SELECT * FROM subscriptions WHERE user_id = ?", (user["id"],))
    if not sub or sub.get("paystack_reference") != reference:
        raise HTTPException(status_code=404, detail={"error": "Reference not found"})
    if sub.get("plan") == sub.get("pending_plan") and sub.get("status") == "active":
        return {"success": True, "alreadyProcessed": True, "plan": sub["plan"]}

    if not is_paystack_configured():
        raise HTTPException(status_code=503, detail={"error": "Paystack is not configured"})

    try:
        verified = paystack.verify_transaction(reference)
    except PaystackError as err:
        if err.status in (400, 404):
            raise HTTPException(status_code=err.status, detail={"error": str(err)})
        raise
    if verified.get("status") != "success":
        raise HTTPException(
            status_code=400,
            detail={"error": f"Payment not successful ({verified.get('status')})"},
        )

    plan = sub.get("pending_plan") or (verified.get("metadata") or {}).get("plan")
    if not plan or plan not in PLANS:
        raise HTTPException(status_code=400, detail={"error": "No plan associated with this payment"})

    subscription = verified.get("subscription") if isinstance(verified.get("subscription"), dict) else {}
    customer = verified.get("customer") if isinstance(verified.get("customer"), dict) else {}
    activate_plan(
        user["id"],
        plan,
        {
            "subscriptionCode": verified.get("subscription_code")
            or subscription.get("subscription_code"),
            "emailToken": customer.get("email_token") or subscription.get("email_token"),
        },
    )
    updated = get_subscription(user["id"])
    return {
        "success": True,
        "plan": updated["plan"],
        "subscription": {**updated, **PLANS[updated["plan"]]},
    }


@router.post("/cancel")
def cancel(user: dict = Depends(require_user)):
    sub = get_subscription(user["id"])
    if sub["plan"] == "free":
        raise HTTPException(status_code=400, detail={"error": "Already on free plan"})

    # Stop future Paystack charges first; the local downgrade is idempotent so
    # it is safe to proceed even if Paystack is briefly unreachable.
    if is_paystack_configured() and sub.get("paystack_subscription_code"):
        try:
            paystack.disable_subscription(
                code=sub["paystack_subscription_code"],
                token=sub.get("paystack_email_token"),
            )
        except Exception as err:
            logger.warning(
                "Could not disable Paystack subscription %s: %s",
                sub["paystack_subscription_code"],
                err,
            )

    db.run(
        """
        UPDATE subscriptions SET plan = 'free', status = 'cancelled',
          cancelled_at = datetime('now'),
          paystack_subscription_code = NULL,
          paystack_email_token = NULL,
          updated_at = datetime('now')
        WHERE user_id = ?
        """,
        (user["id"],),
    )

    notify(user["id"], "system", "Plan Downgraded", "Your plan has been downgraded to Free.")

    return {"success": True, "plan": "free"}


@router.get("/benefits")
def get_benefits(user: dict = Depends(require_user)):
    sub = get_subscription(user["id"])

    is_trial = _is_active_trial(sub)
    effective_plan = "premium" if is_trial else sub["plan"]
    effective = PLANS.get(effective_plan) or PLANS["free"]

    benefits = [
        {
            "icon": "📦",
            "title": "Max Listings",
            "desc": "Unlimited listings" if effective["maxListings"] == -1 else f"{effective['maxListings']} listings",
        },
        {
            "icon": "💰",
            "title": "Transaction Fee",
            "desc": f"{effective['fee'] * 100:.1f}% per sale",
        },
        {
            "icon": "🚀",
            "title": "Free Boosts",
            "desc": f"{effective['boosts']} boosts per month",
        },
        {
            "icon": "⭐",
            "title": "Premium Badge",
            "desc": f'Show "{effective["badge"]}" badge' if effective["badge"] else "No badge",
        },
        {
            "icon": "📊",
            "title": "Analytics",
            "desc": "Full analytics dashboard" if effective_plan != "free" else "Basic analytics",
        },
        {
            "icon": "💬",
            "title": "Support",
            "desc": (
                "Priority support"
                if effective_plan == "pro"
                else ("Email support" if effective_plan == "premium" else "Standard support")
            ),
        },
    ]

    return {"benefits": benefits, "plan": effective_plan, **effective}
