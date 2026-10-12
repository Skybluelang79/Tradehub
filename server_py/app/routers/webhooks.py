import json
import logging
import uuid

from fastapi import APIRouter, HTTPException, Request

from .. import config, db
from ..notifications import notify
from ..paystack import verify_paystack_webhook
from .payments import refund_txn, reserve_item
from .subscriptions import activate_plan, plan_id_for_code

logger = logging.getLogger("tradehub")

router = APIRouter()


def _obj(value):
    # Mirrors JS optional chaining on nested payload fields.
    return value if isinstance(value, dict) else {}


def _plan_code_arg(data):
    # `data.plan` is an object on most payloads but a bare code string on some.
    plan_field = data.get("plan")
    if isinstance(plan_field, dict):
        return plan_field.get("plan_code")
    if isinstance(plan_field, str):
        return plan_field
    return None


def _handle_paystack_event(event_type, data):
    if event_type == "charge.success":
        reference = data.get("reference")
        if not reference:
            raise RuntimeError("Missing reference in charge.success payload")

        txns = db.all(
            "SELECT * FROM transactions WHERE paystack_reference = ? AND status = 'awaiting_payment'",
            (reference,),
        )
        for txn in txns:
            db.run("UPDATE transactions SET status = 'pending' WHERE id = ?", (txn["id"],))
            reserve_item(txn["item_id"])
            notify(
                txn["buyer_id"],
                "payment",
                "Payment Received",
                f'Payment for "{txn["item_title"]}" was received and is held in escrow.',
            )

        # Save the reusable authorization so the buyer can check out faster next time.
        auth = _obj(data.get("authorization"))
        if auth.get("authorization_code") and auth.get("reusable") and len(txns) > 0:
            txn = txns[0]
            try:
                existing = db.get(
                    "SELECT id FROM payment_methods WHERE user_id = ? AND last4 = ? AND brand = ?",
                    (txn["buyer_id"], auth.get("last4"), auth.get("card_type")),
                )
                if existing:
                    db.run(
                        "UPDATE payment_methods SET paystack_authorization_code = ? WHERE id = ?",
                        (auth.get("authorization_code"), existing["id"]),
                    )
                else:
                    db.run(
                        """
                        INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, exp_month, exp_year, is_default)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
                        """,
                        (
                            str(uuid.uuid4()),
                            txn["buyer_id"],
                            auth.get("authorization_code"),
                            auth.get("card_type"),
                            auth.get("card_type"),
                            auth.get("last4"),
                            auth.get("exp_month"),
                            auth.get("exp_year"),
                        ),
                    )
            except Exception as err:
                logger.warning("Could not save paystack auth code: %s", err)

        # Subscription purchase activation (paid plan upgrade). When the charge
        # was initialized with a plan, Paystack returns the subscription
        # identifiers we need to manage renewal/cancellation later.
        meta = _obj(data.get("metadata"))
        sub_info = {
            "subscriptionCode": data.get("subscription_code")
            or _obj(data.get("subscription")).get("subscription_code"),
            "emailToken": _obj(data.get("customer")).get("email_token")
            or _obj(data.get("subscription")).get("email_token"),
        }
        if meta.get("userId") and meta.get("plan"):
            activate_plan(meta["userId"], meta["plan"], sub_info)
        elif sub_info["subscriptionCode"]:
            # Fallback: map the returned plan code back to a tier and match the
            # buyer by the persisted subscription code or their email.
            plan_id = plan_id_for_code(_plan_code_arg(data))
            existing = db.get(
                "SELECT * FROM subscriptions WHERE paystack_subscription_code = ?",
                (sub_info["subscriptionCode"],),
            )
            user = {"id": existing["user_id"]} if existing else None
            customer_email = _obj(data.get("customer")).get("email")
            if not user and customer_email:
                user = db.get("SELECT id FROM users WHERE email = ?", (customer_email,))
            if user and plan_id:
                activate_plan(user["id"], plan_id, sub_info)

        logger.info("Paystack charge succeeded: %s", reference)

    elif event_type == "subscription.create":
        code = data.get("subscription_code")
        email_token = data.get("email_token")
        plan_id = plan_id_for_code(_plan_code_arg(data))
        if code:
            existing = db.get(
                "SELECT * FROM subscriptions WHERE paystack_subscription_code = ?", (code,)
            )
            if existing:
                db.run(
                    """
                    UPDATE subscriptions SET status = 'active',
                      paystack_email_token = COALESCE(?, paystack_email_token),
                      updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (email_token or None, existing["id"]),
                )
            elif plan_id:
                customer_email = _obj(data.get("customer")).get("email")
                user = db.get("SELECT id FROM users WHERE email = ?", (customer_email,)) if customer_email else None
                if user:
                    activate_plan(user["id"], plan_id, {"subscriptionCode": code, "emailToken": email_token})
            logger.info("Paystack subscription created: %s", code)

    elif event_type == "subscription.not_renew":
        code = data.get("subscription_code")
        sub = db.get(
            "SELECT * FROM subscriptions WHERE paystack_subscription_code = ?", (code,)
        ) if code else None
        if sub:
            # Keep access until the end of the paid period; only flag non-renewal.
            db.run(
                """
                UPDATE subscriptions SET status = 'active',
                  cancelled_at = datetime('now'), updated_at = datetime('now')
                WHERE id = ?
                """,
                (sub["id"],),
            )
            notify(
                sub["user_id"],
                "system",
                "Subscription Not Renewing",
                "Your subscription will not renew. You keep access until the end of the current period.",
            )
            logger.info("Paystack subscription not renewing: %s", code)

    elif event_type == "subscription.disable":
        code = data.get("subscription_code")
        sub = db.get(
            "SELECT * FROM subscriptions WHERE paystack_subscription_code = ?", (code,)
        ) if code else None
        if sub and sub["plan"] != "free":
            db.run(
                """
                UPDATE subscriptions SET plan = 'free', status = 'cancelled',
                  cancelled_at = datetime('now'),
                  paystack_subscription_code = NULL,
                  paystack_email_token = NULL,
                  updated_at = datetime('now')
                WHERE id = ?
                """,
                (sub["id"],),
            )
            notify(
                sub["user_id"],
                "system",
                "Plan Cancelled",
                "Your paid plan has been cancelled and moved to Free.",
            )
            logger.info("Paystack subscription disabled: %s", code)

    elif event_type == "invoice.payment_failed":
        code = _obj(data.get("subscription")).get("subscription_code") or data.get("subscription_code")
        sub = db.get(
            "SELECT * FROM subscriptions WHERE paystack_subscription_code = ?", (code,)
        ) if code else None
        customer_email = _obj(data.get("customer")).get("email")
        if not sub and customer_email:
            user = db.get("SELECT id FROM users WHERE email = ?", (customer_email,))
            if user:
                sub = db.get("SELECT * FROM subscriptions WHERE user_id = ?", (user["id"],))
        if sub:
            db.run(
                "UPDATE subscriptions SET status = 'past_due', updated_at = datetime('now') WHERE id = ?",
                (sub["id"],),
            )
            notify(
                sub["user_id"],
                "payment",
                "Subscription Payment Failed",
                "We could not charge your card for your subscription. Please update your payment method to keep your plan.",
            )
            logger.warning("Paystack subscription invoice failed: %s", code or customer_email)

    elif event_type in ("charge.failed", "charge.abandoned"):
        reference = data.get("reference")
        if reference:
            db.run(
                "UPDATE transactions SET status = 'failed' "
                "WHERE paystack_reference = ? AND status = 'awaiting_payment'",
                (reference,),
            )
            logger.warning("Paystack charge failed/abandoned: %s", reference)

    elif event_type == "refund.processed":
        txn_field = data.get("transaction")
        reference = txn_field.get("reference") if isinstance(txn_field, dict) else txn_field
        if not reference:
            return
        txn = db.get("SELECT * FROM transactions WHERE paystack_reference = ?", (reference,))
        if txn and txn["status"] != "refunded":
            # Local bookkeeping only; the Paystack refund already happened.
            refund_txn(txn, {"skip_gateway": True})
            notify(
                txn["buyer_id"],
                "system",
                "Payment Refunded",
                f'Payment for "{txn["item_title"]}" has been refunded.',
            )
            logger.info("Paystack refund processed for %s", reference)

    elif event_type == "transfer.success":
        transfer_code = data.get("transfer_code") or data.get("id")
        recipient_code = _obj(data.get("recipient")).get("recipient_code")
        if not transfer_code:
            return
        payout = db.get("SELECT * FROM payouts WHERE transfer_code = ?", (transfer_code,)) or db.get(
            "SELECT * FROM payouts WHERE recipient_code = ?", (recipient_code,)
        )
        if payout and payout["status"] != "completed":
            if payout["status"] in ("pending", "approved"):
                db.run(
                    "UPDATE wallets SET pending_cents = pending_cents - ? WHERE user_id = ?",
                    (payout["amount_cents"], payout["user_id"]),
                )
            db.run(
                "UPDATE payouts SET status = 'completed', processed_at = datetime('now') WHERE id = ?",
                (payout["id"],),
            )
            notify(
                payout["user_id"],
                "payment",
                "Payout Sent",
                f"Your payout of {payout['amount_cents'] / 100:.2f} has been sent.",
            )
            logger.info("Paystack transfer succeeded: %s", transfer_code)

    elif event_type in ("transfer.failed", "transfer.reversed"):
        transfer_code = data.get("transfer_code") or data.get("id")
        if not transfer_code:
            return
        payout = db.get("SELECT * FROM payouts WHERE transfer_code = ?", (transfer_code,))
        if payout and payout["status"] not in ("rejected", "completed"):
            db.run(
                "UPDATE wallets SET available_cents = available_cents + ?, "
                "pending_cents = pending_cents - ? WHERE user_id = ?",
                (payout["amount_cents"], payout["amount_cents"], payout["user_id"]),
            )
            db.run(
                "UPDATE payouts SET status = 'rejected', processed_at = datetime('now'), "
                "admin_notes = 'Transfer failed at Paystack' WHERE id = ?",
                (payout["id"],),
            )
            notify(
                payout["user_id"],
                "payment",
                "Payout Reverted",
                "Your payout could not be completed and has been returned to your balance.",
            )
            logger.warning("Paystack transfer %s: %s", event_type, transfer_code)

    else:
        logger.debug("Unhandled Paystack event type: %s", event_type)


# Paystack webhook handler. Requires PAYSTACK_WEBHOOK_SECRET to be configured;
# requests without a valid signature are rejected (HMAC-SHA512).
@router.post("/paystack")
async def paystack_webhook(request: Request):
    if not config.PAYSTACK_WEBHOOK_SECRET:
        logger.error("Paystack webhook rejected: PAYSTACK_WEBHOOK_SECRET not configured")
        raise HTTPException(status_code=503, detail={"error": "Paystack webhook secret not configured"})

    raw = await request.body()
    signature = request.headers.get("x-paystack-signature")
    if not verify_paystack_webhook(raw, signature):
        logger.warning("Paystack webhook rejected: invalid signature")
        raise HTTPException(status_code=400, detail={"error": "Invalid signature"})

    try:
        event = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON payload"})

    try:
        _handle_paystack_event(event.get("event"), event.get("data") or {})
    except Exception:
        logger.exception("Paystack webhook handler error")
        raise HTTPException(status_code=500, detail={"error": "Webhook handler error"})

    return {"received": True}


# Legacy Stripe webhook endpoint. Kept as a 404-safe stub so old deploy configs
# that still send to /api/webhooks/stripe don't error; it is not processed.
@router.post("/stripe")
def stripe_webhook():
    return {"received": True, "ignored": True}
