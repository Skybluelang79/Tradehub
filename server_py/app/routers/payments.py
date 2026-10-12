import json
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException

from .. import config, db
from ..currencies import convert, DEFAULT_CURRENCY, is_paystack_currency, is_valid_currency
from ..datetime_util import parse_iso, utc_now
from ..deps import require_admin, require_user
from ..email import send_notification_email
from ..notifications import notify
from ..paystack import (
    PAYSTACK_PUBLIC_KEY,
    PaystackError,
    is_paystack_configured,
    paystack,
    to_major_units,
    to_minor_units,
)
from ..promotions import consume_promo, release_promo, validate_and_apply_promo
from ..referrals import credit_first_purchase

logger = logging.getLogger("tradehub")

router = APIRouter()

ALLOW_DEMO_PAYMENTS = config.DEMO_MODE or not config.IS_PRODUCTION

PLAN_FEES = {"free": 0.04, "premium": 0.04, "pro": 0.04}

CARD_SAVE_AMOUNT_MINOR = 100


# ---- Public helpers (shared with scheduler/admin in the Node service) ---------


def channels_for_method(method):
    if method in ("bank", "paystack_bank"):
        return ["bank_transfer", "card"]
    if method == "bank_transfer":
        return ["bank_transfer"]
    if method == "ussd":
        return ["ussd"]
    if method == "qr":
        return ["qr"]
    if method == "mobile_money":
        return ["mobile_money"]
    return ["card"]


def normalize_payment_method(method):
    raw = str(method or "card").lower()
    if raw in ("bank", "paystack_bank"):
        return "bank"
    if raw in ("bank_transfer", "ussd", "qr", "mobile_money"):
        return raw
    return "card"


def platform_fee_percent():
    try:
        row = db.get("SELECT value FROM platform_settings WHERE key = 'platform_fee_percent'")
        v = float(row["value"]) if row else 4.0
        if v >= 0:
            return v
    except Exception:
        pass
    return 4


def get_fee_rate_for_seller(seller_id):
    admin_percent = platform_fee_percent()
    platform_rate = admin_percent / 100 if admin_percent >= 0 else 0.04
    try:
        sub = db.get(
            "SELECT plan, status, trial_end FROM subscriptions "
            "WHERE user_id = ? AND status IN ('trial', 'active') LIMIT 1",
            (seller_id,),
        )
        if sub and PLAN_FEES.get(sub["plan"]) is not None:
            in_trial = (
                sub["status"] == "trial"
                and sub.get("trial_end")
                and parse_iso(sub["trial_end"]) is not None
                and parse_iso(sub["trial_end"]) > utc_now()
            )
            if sub["status"] == "active" or in_trial:
                plan_rate = PLAN_FEES[sub["plan"]]
                if plan_rate < platform_rate:
                    return plan_rate
    except Exception:
        pass
    return platform_rate


def reserve_item(item_id):
    if not item_id:
        return
    db.run("UPDATE items SET status = 'sold' WHERE id = ? AND status = 'active'", (item_id,))


def get_wallet(user_id):
    w = db.get("SELECT * FROM wallets WHERE user_id = ?", (user_id,))
    if not w:
        db.run("INSERT INTO wallets (user_id) VALUES (?)", (user_id,))
        w = db.get("SELECT * FROM wallets WHERE user_id = ?", (user_id,))
    return w


def insert_transaction(*, txn_id, item, amount, currency, buyer_id, seller_id, method, status,
                       paystack_ref, payment_method_id, promo_code, discount_amount, original_amount,
                       credit_cents=0, provider_ref, bank=None):
    image = db.get(
        "SELECT url FROM item_images WHERE item_id = ? ORDER BY sort_order LIMIT 1", (item["id"],)
    )
    image = image["url"] if image else ""
    bank = bank or {}
    db.run(
        """
        INSERT INTO transactions (id, item_id, item_title, item_image, amount, currency, buyer_id,
            seller_id, payment_method_id, paystack_reference, method, provider_ref, status,
            promo_code, discount_amount, original_amount, credit_cents,
            bank_account_number, bank_account_name, bank_name, bank_expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            txn_id, item["id"], item["title"], image, amount, currency, buyer_id, seller_id,
            payment_method_id or None, paystack_ref or None,
            method, provider_ref or paystack_ref or "", status,
            promo_code or "", discount_amount or 0, original_amount or amount,
            credit_cents or 0,
            bank.get("accountNumber") or None, bank.get("accountName") or None,
            bank.get("bankName") or None, bank.get("expiresAt") or None,
        ),
    )
    if status == "pending":
        reserve_item(item["id"])


def attach_bank_details(txn_id, charge):
    charge = charge or {}
    bank = (charge.get("bank") or {}).get("name") or charge.get("bank_name")
    db.run(
        """
        UPDATE transactions
        SET bank_account_number = ?, bank_account_name = ?, bank_name = ?, bank_expires_at = ?, transaction_reference = ?
        WHERE id = ?
        """,
        (
            charge.get("account_number") or None,
            charge.get("account_name") or None,
            bank or None,
            charge.get("account_expires_at") or None,
            charge.get("transaction_reference") or None,
            txn_id,
        ),
    )


def public_bank_transfer(txn):
    if not txn or not txn.get("bank_account_number"):
        return None
    return {
        "accountNumber": txn["bank_account_number"],
        "accountName": txn.get("bank_account_name"),
        "bankName": txn.get("bank_name"),
        "expiresAt": txn.get("bank_expires_at"),
        "amount": txn.get("amount"),
        "currency": txn.get("currency"),
        "transactionReference": txn.get("transaction_reference"),
        "reference": txn.get("paystack_reference"),
    }


def get_gift_card(code):
    card = db.get(
        "SELECT * FROM gift_cards WHERE UPPER(code) = ?", (str(code or "").strip().upper(),)
    )
    if not card:
        raise HTTPException(status_code=400, detail={"error": "Invalid gift card code"})
    if card["status"] == "redeemed":
        raise HTTPException(status_code=400, detail={"error": "Gift card already redeemed"})
    if card["status"] == "voided":
        raise HTTPException(status_code=400, detail={"error": "Gift card has been voided"})
    if card["balance_cents"] <= 0:
        raise HTTPException(status_code=400, detail={"error": "Gift card has no balance"})
    if card.get("expires_at") and parse_iso(card["expires_at"]) and parse_iso(card["expires_at"]) < utc_now():
        raise HTTPException(status_code=400, detail={"error": "Gift card has expired"})
    return card


def calculate_credit(user_id, gift_card_code, amount_cents):
    wallet = get_wallet(user_id)
    available_cents = wallet["credit_cents"]
    gift_card = None
    if gift_card_code:
        gift_card = get_gift_card(gift_card_code)
        available_cents += gift_card["balance_cents"]
    credit_cents = min(available_cents, amount_cents)
    return {"credit_cents": credit_cents, "gift_card": gift_card}


def apply_credit(user_id, gift_card, credit_cents):
    if not credit_cents or credit_cents <= 0:
        return
    remaining = credit_cents
    if gift_card:
        card_use = min(gift_card["balance_cents"], remaining)
        remaining -= card_use
        new_balance = gift_card["balance_cents"] - card_use
        if new_balance <= 0:
            db.run(
                "UPDATE gift_cards SET status = 'redeemed', balance_cents = 0, redeemed_by = ?, redeemed_at = datetime('now') WHERE id = ?",
                (user_id, gift_card["id"]),
            )
        else:
            db.run(
                "UPDATE gift_cards SET balance_cents = ?, updated_at = datetime('now') WHERE id = ?",
                (new_balance, gift_card["id"]),
            )
    if remaining > 0:
        get_wallet(user_id)
        db.run(
            "UPDATE wallets SET credit_cents = credit_cents - ?, updated_at = datetime('now') WHERE user_id = ?",
            (remaining, user_id),
        )


def restore_credit(user_id, credit_cents):
    if not credit_cents or credit_cents <= 0:
        return
    get_wallet(user_id)
    db.run(
        "UPDATE wallets SET credit_cents = credit_cents + ?, updated_at = datetime('now') WHERE user_id = ?",
        (credit_cents, user_id),
    )


def save_authorization(user_id, auth):
    try:
        brand = auth.get("brand") or auth.get("card_type") or ""
        card_type = auth.get("card_type") or ""
        existing = db.get(
            "SELECT id FROM payment_methods WHERE user_id = ? AND last4 = ? AND brand = ?",
            (user_id, auth.get("last4"), brand),
        )
        if existing:
            db.run(
                "UPDATE payment_methods SET paystack_authorization_code = ?, card_type = ? WHERE id = ?",
                (auth.get("authorization_code"), card_type, existing["id"]),
            )
            return existing["id"]
        method_id = str(uuid.uuid4())
        db.run(
            """
            INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, exp_month, exp_year, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (
                method_id, user_id, auth.get("authorization_code"), brand,
                card_type, auth.get("last4"), auth.get("exp_month"), auth.get("exp_year"),
            ),
        )
        return method_id
    except Exception as err:
        logger.warning("Could not save payment method: %s", err)
        return None


def get_cart(user_id):
    return db.all(
        """
        SELECT c.item_id, c.quantity, c.created_at,
          i.title, i.price, i.sale_price, i.currency, i.category, i.condition, i.status,
          i.seller_id, i.quantity AS stock,
          (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) AS image,
          u.name AS seller_name, u.avatar AS seller_avatar
        FROM carts c
        JOIN items i ON i.id = c.item_id
        LEFT JOIN users u ON u.id = i.seller_id
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC
        """,
        (user_id,),
    )


def cart_subtotal(items):
    return sum(
        round((it["sale_price"] or it["price"]) * it["quantity"] * 100) for it in items
    )


def insert_cart_line(line, index, txn_ids, method, status, paystack_ref, payment_method_id,
                     promo_code_used, currency, buyer_id):
    insert_transaction(
        txn_id=txn_ids[index],
        item=line["item"],
        amount=line["line_net_cents"] / 100,
        currency=currency,
        buyer_id=buyer_id,
        seller_id=line["item"]["seller_id"],
        method=method,
        status=status,
        paystack_ref=paystack_ref,
        payment_method_id=payment_method_id,
        promo_code=promo_code_used,
        discount_amount=line["line_discount_cents"] / 100,
        original_amount=line["base_amount"],
        credit_cents=line["line_credit_cents"],
        provider_ref=None,
    )


def build_checkout(body, user_id):
    item_id = body.get("itemId")
    offer_id = body.get("offerId")
    gift_card_code = body.get("giftCardCode")
    promo_code = body.get("promoCode")
    use_credit = body.get("useCredit")

    offer = db.get("SELECT * FROM offers WHERE id = ?", (offer_id,)) if offer_id else None
    actual_item_id = offer["item_id"] if offer else item_id
    item = db.get("SELECT * FROM items WHERE id = ?", (actual_item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] == user_id:
        raise HTTPException(status_code=400, detail={"error": "Cannot buy your own item"})
    if offer:
        if offer["buyer_id"] != user_id:
            raise HTTPException(status_code=403, detail={"error": "Not authorized to purchase with this offer"})
        if offer["status"] != "accepted":
            raise HTTPException(status_code=400, detail={"error": "Offer has not been accepted yet"})
        if offer["item_id"] != item["id"]:
            raise HTTPException(status_code=400, detail={"error": "Offer does not match this item"})
    else:
        if item["status"] == "sold":
            raise HTTPException(status_code=400, detail={"error": "Item is already sold"})

    item_currency = (
        offer["currency"] if offer and is_valid_currency(offer.get("currency"))
        else (item["currency"] if is_valid_currency(item.get("currency")) else DEFAULT_CURRENCY)
    )

    raw_method = str(body.get("method") or "card").lower()
    method = normalize_payment_method(raw_method)
    wants_credit = raw_method in ("credit", "gift_card") or bool(gift_card_code) or use_credit is True
    uses_promo = bool(promo_code) and str(promo_code).strip() != ""
    settlement_currency = (
        item_currency if (not wants_credit and not uses_promo and is_paystack_currency(item_currency))
        else DEFAULT_CURRENCY
    )

    base_amount_item = (offer["amount_cents"] / 100) if offer else (item.get("sale_price") or item["price"])
    base_amount = convert(base_amount_item, item_currency, settlement_currency)

    promo_discount = 0.0
    promo_code_used = None
    if promo_code:
        applied = validate_and_apply_promo(promo_code, base_amount)
        promo_discount = applied["discount"]
        promo_code_used = str(promo_code).strip().upper()
    amount = round((base_amount - promo_discount) * 100) / 100
    amount_cents = round(amount * 100)
    promo_info = {"code": promo_code_used, "discount": promo_discount} if promo_code_used else None

    credit_cents = 0
    gift_card = None
    if wants_credit:
        calc = calculate_credit(user_id, gift_card_code, amount_cents)
        credit_cents = calc["credit_cents"]
        gift_card = calc["gift_card"]

    if raw_method in ("credit", "gift_card") and credit_cents < amount_cents:
        raise HTTPException(
            status_code=402,
            detail={"error": "Insufficient store credit", "creditCents": credit_cents, "amountCents": amount_cents},
        )

    charge_cents = amount_cents - credit_cents
    return {
        "item": item, "amount": amount, "amount_cents": amount_cents, "currency": settlement_currency,
        "base_amount": base_amount, "item_currency": item_currency, "promo_discount": promo_discount,
        "promo_code_used": promo_code_used, "promo_info": promo_info, "credit_cents": credit_cents,
        "gift_card": gift_card, "charge_cents": charge_cents, "offer_id": offer["id"] if offer else None,
    }


def _check(txn, user):
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["buyer_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    return txn


def ensure_charge_succeeded(charge):
    # Paystack answers charge_authorization with a top-level `status: true` even
    # when the underlying charge needs extra verification or has failed, so the
    # real outcome lives in the unwrapped payload's `status` field.
    status = (charge or {}).get("status")
    if status == "success":
        return charge
    if status in ("send_otp", "pay_offline", "open_url"):
        message = (charge or {}).get("message") or "This card needs additional verification before the payment can complete"
        raise HTTPException(status_code=402, detail={"error": message, "requiresAction": status})
    raise HTTPException(status_code=502, detail={"error": f"Card charge was not successful ({status or 'unknown'})"})


# ---- Saved payment methods ----------------------------------------------------


@router.get("/methods")
def list_payment_methods(user: dict = Depends(require_user)):
    methods = db.all(
        "SELECT id, brand, card_type, last4, exp_month, exp_year, is_default, created_at "
        "FROM payment_methods WHERE user_id = ? ORDER BY is_default DESC",
        (user["id"],),
    )
    return {"methods": methods}


@router.post("/methods", status_code=201)
def add_payment_method(user: dict = Depends(require_user), body: dict = Body(...)):
    brand = body.get("brand")
    last4 = body.get("last4")
    authorization_code = body.get("authorizationCode")
    card_type = body.get("card_type") or ""
    is_default = body.get("isDefault")
    if (not brand or not last4) and not authorization_code:
        raise HTTPException(status_code=400, detail={"error": "Card details required"})
    if is_default:
        db.run("UPDATE payment_methods SET is_default = 0 WHERE user_id = ?", (user["id"],))
    method_id = str(uuid.uuid4())
    db.run(
        """
        INSERT INTO payment_methods (id, user_id, paystack_authorization_code, brand, card_type, last4, exp_month, exp_year, is_default)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            method_id, user["id"], authorization_code or None, brand, card_type, last4,
            body.get("exp_month") or None, body.get("exp_year") or None, 1 if is_default else 0,
        ),
    )
    method = db.get("SELECT * FROM payment_methods WHERE id = ?", (method_id,))
    return {"method": method}


@router.post("/methods/tokenize")
def tokenize_card(user: dict = Depends(require_user)):
    try:
        if not is_paystack_configured():
            raise HTTPException(status_code=503, detail={"error": "Saving a card requires Paystack to be configured"})
        usr = db.get("SELECT email FROM users WHERE id = ?", (user["id"],))
        if not usr or not usr["email"]:
            raise HTTPException(status_code=400, detail={"error": "Add an email to your account before saving a card"})
        reference = f"save_{uuid.uuid4()}"
        initialized = paystack.initialize_transaction(
            amount_minor=CARD_SAVE_AMOUNT_MINOR,
            currency=DEFAULT_CURRENCY,
            email=usr["email"],
            reference=reference,
            channels=["card"],
            metadata={"type": "card_save", "purpose": "saved_payment_method"},
        )
        return {
            "reference": reference,
            "accessCode": initialized.get("access_code"),
            "publicKey": PAYSTACK_PUBLIC_KEY,
            "currency": DEFAULT_CURRENCY,
            "amountMinor": CARD_SAVE_AMOUNT_MINOR,
            "email": usr["email"],
        }
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})


@router.post("/methods/tokenize/{reference}")
def confirm_tokenized_card(reference: str, user: dict = Depends(require_user), body: dict = Body(...)):
    try:
        if not is_paystack_configured():
            raise HTTPException(status_code=503, detail={"error": "Paystack is not configured"})
        verified = paystack.verify_transaction(reference)
        if verified.get("status") != "success" or not (verified.get("authorization") or {}).get("authorization_code"):
            raise HTTPException(
                status_code=400,
                detail={"error": f"Card verification not successful ({verified.get('status') or 'unknown'})"},
            )
        method_id = save_authorization(user["id"], verified.get("authorization") or {})
        if not method_id:
            raise HTTPException(status_code=500, detail={"error": "Could not save card"})
        if body.get("isDefault"):
            db.run("UPDATE payment_methods SET is_default = 0 WHERE user_id = ?", (user["id"],))
            db.run("UPDATE payment_methods SET is_default = 1 WHERE id = ?", (method_id,))
        try:
            paystack.refund_transaction(reference)
            logger.info("Refunded card-save charge %s", reference)
        except Exception as refund_err:
            logger.warning("Card-save refund for %s failed: %s", reference, refund_err)
        method = db.get(
            "SELECT id, brand, card_type, last4, exp_month, exp_year, is_default, created_at "
            "FROM payment_methods WHERE id = ?",
            (method_id,),
        )
        return {"method": method}
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})


@router.put("/methods/{method_id}/default")
def set_default_method(method_id: str, user: dict = Depends(require_user)):
    db.run("UPDATE payment_methods SET is_default = 0 WHERE user_id = ?", (user["id"],))
    db.run("UPDATE payment_methods SET is_default = 1 WHERE id = ? AND user_id = ?", (method_id, user["id"]))
    return {"success": True}


@router.delete("/methods/{method_id}")
def remove_payment_method(method_id: str, user: dict = Depends(require_user)):
    db.run("DELETE FROM payment_methods WHERE id = ? AND user_id = ?", (method_id, user["id"]))
    return {"success": True}


# ---- Wallet / options ----------------------------------------------------------


@router.get("/wallet")
def wallet(user: dict = Depends(require_user)):
    return {"wallet": get_wallet(user["id"])}


@router.get("/options")
def payment_options(user: dict = Depends(require_user)):
    wallet = get_wallet(user["id"])
    configured = is_paystack_configured()
    bank_enabled = configured and config.PAYSTACK_BANK_TRANSFER_ENABLED
    return {
        "feePercent": platform_fee_percent(),
        "publicKey": PAYSTACK_PUBLIC_KEY,
        "live": configured,
        "currency": DEFAULT_CURRENCY,
        "methods": [
            {
                "id": "card",
                "name": "Paystack Card" if configured else "Card",
                "enabled": True,
                "channels": ["card"],
                "description": "Pay instantly with any debit or credit card (Visa, Mastercard, Verve) inside TradeHub.",
                "live": configured,
            },
            {
                "id": "bank_transfer",
                "name": "Dedicated Bank Transfer",
                "enabled": bank_enabled,
                "channels": ["bank_transfer"],
                "inApp": True,
                "description": "Get a dedicated account number for this order and pay by transfer from any bank app.",
                "live": configured,
            },
            {
                "id": "paystack_bank",
                "name": "Paystack Bank Transfer",
                "enabled": bank_enabled,
                "channels": ["bank_transfer", "card"],
                "description": "Pay via a dedicated Paystack bank account generated for this order. Funds are auto-confirmed.",
                "live": configured,
            },
            {
                "id": "ussd",
                "name": "USSD",
                "enabled": configured,
                "channels": ["ussd"],
                "description": "Dial a USSD code on your phone to complete the payment.",
                "live": configured,
            },
            {
                "id": "mobile_money",
                "name": "Mobile Money",
                "enabled": configured,
                "channels": ["mobile_money"],
                "description": "Pay with MTN, Airtel or other mobile money wallets.",
                "live": configured,
            },
            {
                "id": "qr",
                "name": "QR Code",
                "enabled": configured,
                "channels": ["qr"],
                "description": "Scan a QR code with your banking app to pay.",
                "live": configured,
            },
            {
                "id": "gift_card",
                "name": "Gift Card / Store Credit",
                "enabled": True,
                "channels": [],
                "description": "Use gift card credit or your store credit balance at checkout.",
                "creditCents": wallet["credit_cents"],
            },
        ],
    }


# ---- Checkout (single item) ----------------------------------------------------


@router.post("/create-intent")
def create_intent(user: dict = Depends(require_user), body: dict = Body(...)):
    try:
        b = build_checkout(body, user["id"])
        method = normalize_payment_method(body.get("method"))
        txn_id = str(uuid.uuid4())

        if b["charge_cents"] == 0:
            apply_credit(user["id"], b["gift_card"], b["credit_cents"])
            insert_transaction(
                txn_id=txn_id, item=b["item"], amount=b["amount"], currency=b["currency"],
                buyer_id=user["id"], seller_id=b["item"]["seller_id"], method="credit", status="pending",
                paystack_ref=None, payment_method_id=None, promo_code=b["promo_code_used"],
                discount_amount=b["promo_discount"], original_amount=b["base_amount"],
                credit_cents=b["credit_cents"], provider_ref=None,
            )
            return {
                "transactionId": txn_id, "status": "pending", "method": "credit", "paid": True,
                "amountCents": b["amount_cents"], "creditCents": b["credit_cents"],
                "promo": b["promo_info"], "currency": b["currency"],
            }

        if body.get("paymentMethodId"):
            saved_method = db.get(
                "SELECT * FROM payment_methods WHERE id = ? AND user_id = ?",
                (body["paymentMethodId"], user["id"]),
            )
            if not saved_method:
                raise HTTPException(status_code=400, detail={"error": "Saved card not found"})
            if not saved_method.get("paystack_authorization_code"):
                raise HTTPException(status_code=400, detail={"error": "This saved card cannot be charged yet"})
            if not is_paystack_configured():
                raise HTTPException(status_code=503, detail={"error": "Payments are not configured"})
            try:
                charge = paystack.charge_authorization(
                    amount_minor=to_minor_units(b["charge_cents"] / 100, b["currency"]),
                    currency=b["currency"],
                    email=user["email"],
                    authorization_code=saved_method["paystack_authorization_code"],
                    reference=txn_id,
                    metadata={
                        "itemId": b["item"]["id"], "buyerId": user["id"],
                        "sellerId": b["item"]["seller_id"], "tradehub_transaction": txn_id,
                    },
                )
            except PaystackError as err:
                raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
            ensure_charge_succeeded(charge)
            apply_credit(user["id"], b["gift_card"], b["credit_cents"])
            insert_transaction(
                txn_id=txn_id, item=b["item"], amount=b["amount"], currency=b["currency"],
                buyer_id=user["id"], seller_id=b["item"]["seller_id"], method="saved_card", status="pending",
                paystack_ref=txn_id, payment_method_id=saved_method["id"], promo_code=b["promo_code_used"],
                discount_amount=b["promo_discount"], original_amount=b["base_amount"],
                credit_cents=b["credit_cents"], provider_ref=None,
            )
            notify(user["id"], "payment", "Payment Received",
                   f"Payment of {b['amount']} {b['currency']} for \"{b['item']['title']}\" was received and is held in escrow.")
            return {
                "paid": True, "transactionId": txn_id, "status": "pending", "method": "saved_card",
                "amountCents": b["amount_cents"], "chargeCents": b["charge_cents"],
                "creditCents": b["credit_cents"], "promo": b["promo_info"], "currency": b["currency"],
            }

        if not is_paystack_configured():
            if not ALLOW_DEMO_PAYMENTS:
                raise HTTPException(
                    status_code=503,
                    detail={"error": "Payments are not configured. Set PAYSTACK_SECRET_KEY or enable DEMO_MODE."},
                )
            apply_credit(user["id"], b["gift_card"], b["credit_cents"])
            insert_transaction(
                txn_id=txn_id, item=b["item"], amount=b["amount"], currency=b["currency"],
                buyer_id=user["id"], seller_id=b["item"]["seller_id"], method=method, status="pending",
                paystack_ref=f"demo_{txn_id}", payment_method_id=None, promo_code=b["promo_code_used"],
                discount_amount=b["promo_discount"], original_amount=b["base_amount"],
                credit_cents=b["credit_cents"], provider_ref=None,
            )
            return {
                "demo": True, "transactionId": txn_id, "status": "pending", "paid": True,
                "amountCents": b["amount_cents"], "creditCents": b["credit_cents"],
                "promo": b["promo_info"], "currency": b["currency"],
            }

        if method == "bank_transfer":
            try:
                charge = paystack.charge_bank_transfer(
                    amount_minor=to_minor_units(b["charge_cents"] / 100, b["currency"]),
                    currency=b["currency"],
                    email=user["email"],
                    reference=txn_id,
                    metadata={
                        "itemId": b["item"]["id"], "buyerId": user["id"],
                        "sellerId": b["item"]["seller_id"], "tradehub_transaction": txn_id,
                    },
                    expires_at=_bank_transfer_expires(),
                )
            except PaystackError as err:
                raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
            apply_credit(user["id"], b["gift_card"], b["credit_cents"])
            insert_transaction(
                txn_id=txn_id, item=b["item"], amount=b["amount"], currency=b["currency"],
                buyer_id=user["id"], seller_id=b["item"]["seller_id"], method=method, status="awaiting_payment",
                paystack_ref=txn_id, payment_method_id=None, promo_code=b["promo_code_used"],
                discount_amount=b["promo_discount"], original_amount=b["base_amount"],
                credit_cents=b["credit_cents"], provider_ref=None,
            )
            attach_bank_details(txn_id, charge)
            txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
            return {
                "transactionId": txn_id, "reference": txn_id, "status": "awaiting_payment", "method": method,
                "amountCents": b["amount_cents"], "chargeCents": b["charge_cents"],
                "creditCents": b["credit_cents"], "currency": b["currency"],
                "promo": b["promo_info"], "bankTransfer": public_bank_transfer(txn),
            }

        channels = channels_for_method(method)
        try:
            initialized = paystack.initialize_transaction(
                amount_minor=to_minor_units(b["charge_cents"] / 100, b["currency"]),
                currency=b["currency"],
                email=user["email"],
                reference=txn_id,
                channels=channels,
                metadata={
                    "itemId": b["item"]["id"], "buyerId": user["id"],
                    "sellerId": b["item"]["seller_id"], "tradehub_transaction": txn_id,
                },
                callback_url=_paystack_callback_url(),
            )
        except PaystackError as err:
            raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
        apply_credit(user["id"], b["gift_card"], b["credit_cents"])
        insert_transaction(
            txn_id=txn_id, item=b["item"], amount=b["amount"], currency=b["currency"],
            buyer_id=user["id"], seller_id=b["item"]["seller_id"], method=method, status="awaiting_payment",
            paystack_ref=txn_id, payment_method_id=None, promo_code=b["promo_code_used"],
            discount_amount=b["promo_discount"], original_amount=b["base_amount"],
            credit_cents=b["credit_cents"], provider_ref=None,
        )
        return {
            "transactionId": txn_id, "reference": txn_id,
            "accessCode": initialized.get("access_code"), "authorizationUrl": initialized.get("authorization_url"),
            "publicKey": PAYSTACK_PUBLIC_KEY, "status": "awaiting_payment", "method": method, "channels": channels,
            "amountCents": b["amount_cents"], "chargeCents": b["charge_cents"],
            "creditCents": b["credit_cents"], "currency": b["currency"], "promo": b["promo_info"],
        }
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})


# ---- Cart ----------------------------------------------------------------------


@router.get("/cart")
def get_cart_route(user: dict = Depends(require_user)):
    items = get_cart(user["id"])
    return {"items": items, "count": len(items), "subtotalCents": cart_subtotal(items)}


@router.post("/cart", status_code=201)
def add_to_cart(user: dict = Depends(require_user), body: dict = Body(...)):
    quantity = body.get("quantity", 1)
    qty = max(1, int(quantity or 1))
    item_id = body.get("itemId")
    if not item_id:
        raise HTTPException(status_code=400, detail={"error": "Item required"})

    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if not item:
        raise HTTPException(status_code=404, detail={"error": "Item not found"})
    if item["seller_id"] == user["id"]:
        raise HTTPException(status_code=400, detail={"error": "Cannot add your own item to cart"})
    if item["status"] == "sold":
        raise HTTPException(status_code=400, detail={"error": "Item is already sold"})
    if item["quantity"] is not None and item["quantity"] > 0 and qty > item["quantity"]:
        raise HTTPException(status_code=400, detail={"error": f"Only {item['quantity']} available"})

    db.run(
        """
        INSERT INTO carts (user_id, item_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = datetime('now')
        """,
        (user["id"], item_id, qty),
    )
    cart = get_cart(user["id"])
    return {"items": cart, "count": len(cart), "subtotalCents": cart_subtotal(cart)}


@router.put("/cart/{item_id}")
def update_cart(item_id: str, user: dict = Depends(require_user), body: dict = Body(...)):
    quantity = body.get("quantity")
    qty = max(1, int(quantity or 1))
    item = db.get("SELECT * FROM items WHERE id = ?", (item_id,))
    if item and item["quantity"] is not None and item["quantity"] > 0 and qty > item["quantity"]:
        raise HTTPException(status_code=400, detail={"error": f"Only {item['quantity']} available"})
    db.run(
        "UPDATE carts SET quantity = ?, updated_at = datetime('now') WHERE user_id = ? AND item_id = ?",
        (qty, user["id"], item_id),
    )
    cart = get_cart(user["id"])
    return {"items": cart, "count": len(cart), "subtotalCents": cart_subtotal(cart)}


@router.delete("/cart/{item_id}")
def remove_cart_item(item_id: str, user: dict = Depends(require_user)):
    db.run("DELETE FROM carts WHERE user_id = ? AND item_id = ?", (user["id"], item_id))
    cart = get_cart(user["id"])
    return {"items": cart, "count": len(cart), "subtotalCents": cart_subtotal(cart)}


@router.delete("/cart")
def clear_cart(user: dict = Depends(require_user)):
    db.run("DELETE FROM carts WHERE user_id = ?", (user["id"],))
    return {"success": True, "items": [], "count": 0, "subtotalCents": 0}


@router.post("/cart/checkout")
def cart_checkout(user: dict = Depends(require_user), body: dict = Body(...)):
    try:
        raw_method = body.get("method", "card")
        method = normalize_payment_method(raw_method)
        gift_card_code = body.get("giftCardCode")
        promo_code = body.get("promoCode")
        cart_items = get_cart(user["id"])
        if not cart_items:
            raise HTTPException(status_code=400, detail={"error": "Your cart is empty"})

        raw_lines = []
        for line in cart_items:
            item = db.get("SELECT * FROM items WHERE id = ?", (line["item_id"],))
            if not item:
                raise HTTPException(status_code=400, detail={"error": "Item no longer exists"})
            if item["seller_id"] == user["id"]:
                raise HTTPException(status_code=400, detail={"error": "Cannot buy your own item"})
            if item["status"] == "sold":
                raise HTTPException(status_code=400, detail={"error": f"\"{item['title']}\" is already sold"})
            if item["quantity"] is not None and item["quantity"] > 0 and line["quantity"] > item["quantity"]:
                raise HTTPException(
                    status_code=400,
                    detail={"error": f"Only {item['quantity']} of \"{item['title']}\" available"},
                )
            raw_lines.append({
                "item": item,
                "quantity": line["quantity"],
                "item_currency": item["currency"] if is_valid_currency(item.get("currency")) else DEFAULT_CURRENCY,
                "base_amount_item": (item.get("sale_price") or item["price"]) * line["quantity"],
            })

        wants_credit = method in ("credit", "gift_card") or bool(gift_card_code)
        uses_promo = bool(promo_code) and str(promo_code).strip() != ""
        line_currencies = sorted({l["item_currency"] for l in raw_lines})
        single_supported = len(line_currencies) == 1 and is_paystack_currency(line_currencies[0])
        currency = line_currencies[0] if (not wants_credit and not uses_promo and single_supported) else DEFAULT_CURRENCY

        lines = [
            {"item": l["item"], "quantity": l["quantity"],
             "base_amount": convert(l["base_amount_item"], l["item_currency"], currency)}
            for l in raw_lines
        ]

        subtotal_cents = round(sum(l["base_amount"] for l in lines) * 100)
        subtotal = subtotal_cents / 100

        promo_discount = 0.0
        promo_code_used = None
        if promo_code:
            applied = validate_and_apply_promo(promo_code, subtotal)
            promo_discount = applied["discount"]
            promo_code_used = str(promo_code).strip().upper()
        promo_info = {"code": promo_code_used, "discount": promo_discount} if promo_code_used else None

        allocated = []
        for l in lines:
            line_subtotal_cents = round(l["base_amount"] * 100)
            line_discount_cents = 0
            if promo_discount > 0:
                line_discount_cents = round((line_subtotal_cents / subtotal_cents) * round(promo_discount * 100))
            line_net_cents = line_subtotal_cents - line_discount_cents
            allocated.append({**l, "line_subtotal_cents": line_subtotal_cents,
                              "line_discount_cents": line_discount_cents, "line_net_cents": line_net_cents})

        total_cents = sum(l["line_net_cents"] for l in allocated)
        if promo_discount > 0:
            expected = round((subtotal - promo_discount) * 100)
            drift = expected - total_cents
            if drift != 0:
                allocated[-1]["line_net_cents"] += drift
                allocated[-1]["line_discount_cents"] -= drift
                total_cents = expected

        calc = calculate_credit(user["id"], gift_card_code, total_cents)
        credit_cents = calc["credit_cents"]
        gift_card = calc["gift_card"]
        remaining_credit = credit_cents
        for l in allocated:
            use = min(remaining_credit, l["line_net_cents"])
            l["line_credit_cents"] = use
            remaining_credit -= use
        charge_cents = total_cents - credit_cents

        txn_ids = [str(uuid.uuid4()) for _ in allocated]
        paystack_ref = str(uuid.uuid4()) if charge_cents > 0 else None

        if charge_cents == 0:
            apply_credit(user["id"], gift_card, credit_cents)
            for i, l in enumerate(allocated):
                insert_cart_line(l, i, txn_ids, "credit", "pending", None, None, promo_code_used, currency, user["id"])
            db.run("DELETE FROM carts WHERE user_id = ?", (user["id"],))
            return {"paid": True, "status": "pending", "method": "credit", "transactionIds": txn_ids,
                    "totalCents": total_cents, "creditCents": credit_cents, "count": len(allocated),
                    "promo": promo_info, "currency": currency}

        if body.get("paymentMethodId"):
            saved_method = db.get(
                "SELECT * FROM payment_methods WHERE id = ? AND user_id = ?",
                (body["paymentMethodId"], user["id"]),
            )
            if not saved_method:
                raise HTTPException(status_code=400, detail={"error": "Saved card not found"})
            if not saved_method.get("paystack_authorization_code"):
                raise HTTPException(status_code=400, detail={"error": "This saved card cannot be charged yet"})
            if not is_paystack_configured():
                raise HTTPException(status_code=503, detail={"error": "Payments are not configured"})
            try:
                charge = paystack.charge_authorization(
                    amount_minor=to_minor_units(charge_cents / 100, currency),
                    currency=currency,
                    email=user["email"],
                    authorization_code=saved_method["paystack_authorization_code"],
                    reference=paystack_ref,
                    metadata={"itemIds": [l["item"]["id"] for l in allocated], "buyerId": user["id"],
                              "tradehub_transaction": paystack_ref},
                )
            except PaystackError as err:
                raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
            ensure_charge_succeeded(charge)
            apply_credit(user["id"], gift_card, credit_cents)
            for i, l in enumerate(allocated):
                insert_cart_line(l, i, txn_ids, "saved_card", "pending", paystack_ref, saved_method["id"],
                                 promo_code_used, currency, user["id"])
            for l in allocated:
                notify(user["id"], "payment", "Payment Received",
                       f"Payment for \"{l['item']['title']}\" was received and is held in escrow.")
            db.run("DELETE FROM carts WHERE user_id = ?", (user["id"],))
            return {"paid": True, "status": "pending", "method": "saved_card", "transactionIds": txn_ids,
                    "totalCents": total_cents, "chargeCents": charge_cents, "creditCents": credit_cents,
                    "count": len(allocated), "promo": promo_info, "currency": currency}

        if not is_paystack_configured():
            if not ALLOW_DEMO_PAYMENTS:
                raise HTTPException(
                    status_code=503,
                    detail={"error": "Payments are not configured. Set PAYSTACK_SECRET_KEY or enable DEMO_MODE."},
                )
            apply_credit(user["id"], gift_card, credit_cents)
            for i, l in enumerate(allocated):
                insert_cart_line(l, i, txn_ids, method, "pending", f"demo_{txn_ids[i]}", None,
                                 promo_code_used, currency, user["id"])
            db.run("DELETE FROM carts WHERE user_id = ?", (user["id"],))
            return {"demo": True, "paid": True, "status": "pending", "transactionIds": txn_ids,
                    "totalCents": total_cents, "creditCents": credit_cents, "count": len(allocated),
                    "promo": promo_info, "currency": currency}

        if method == "bank_transfer":
            try:
                charge = paystack.charge_bank_transfer(
                    amount_minor=to_minor_units(charge_cents / 100, currency),
                    currency=currency,
                    email=user["email"],
                    reference=paystack_ref,
                    metadata={"itemIds": [l["item"]["id"] for l in allocated], "buyerId": user["id"],
                              "tradehub_transaction": paystack_ref},
                    expires_at=_bank_transfer_expires(),
                )
            except PaystackError as err:
                raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
            apply_credit(user["id"], gift_card, credit_cents)
            for i, l in enumerate(allocated):
                insert_cart_line(l, i, txn_ids, method, "awaiting_payment", paystack_ref, None,
                                 promo_code_used, currency, user["id"])
            for each_id in txn_ids:
                attach_bank_details(each_id, charge)
            db.run("DELETE FROM carts WHERE user_id = ?", (user["id"],))
            txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_ids[0],))
            return {"transactionIds": txn_ids, "reference": paystack_ref, "status": "awaiting_payment",
                    "method": method, "totalCents": total_cents, "chargeCents": charge_cents,
                    "creditCents": credit_cents, "count": len(allocated), "promo": promo_info,
                    "currency": currency, "bankTransfer": public_bank_transfer(txn)}

        channels = channels_for_method(method)
        try:
            initialized = paystack.initialize_transaction(
                amount_minor=to_minor_units(charge_cents / 100, currency),
                currency=currency,
                email=user["email"],
                reference=paystack_ref,
                channels=channels,
                metadata={"itemIds": [l["item"]["id"] for l in allocated], "buyerId": user["id"],
                          "tradehub_transaction": paystack_ref},
                callback_url=_paystack_callback_url(),
            )
        except PaystackError as err:
            raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
        apply_credit(user["id"], gift_card, credit_cents)
        for i, l in enumerate(allocated):
            insert_cart_line(l, i, txn_ids, method, "awaiting_payment", paystack_ref, None,
                             promo_code_used, currency, user["id"])
        db.run("DELETE FROM carts WHERE user_id = ?", (user["id"],))
        return {
            "transactionIds": txn_ids, "reference": paystack_ref,
            "accessCode": initialized.get("access_code"), "authorizationUrl": initialized.get("authorization_url"),
            "publicKey": PAYSTACK_PUBLIC_KEY, "status": "awaiting_payment", "method": method, "channels": channels,
            "totalCents": total_cents, "chargeCents": charge_cents, "creditCents": credit_cents,
            "count": len(allocated), "promo": promo_info, "currency": currency,
        }
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})


# ---- Verification ---------------------------------------------------------------


@router.post("/verify/{reference}")
def verify_payment(reference: str, user: dict = Depends(require_user)):
    try:
        txns = db.all(
            "SELECT * FROM transactions WHERE paystack_reference = ? ORDER BY created_at",
            (reference,),
        )
        if not txns:
            raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
        # A cart checkout shares one Paystack reference across every line, so
        # all of the rows behind it must be settled together.
        for txn in txns:
            _check(txn, user)

        active = [t for t in txns if t["status"] == "awaiting_payment"]
        if not active:
            status = txns[0]["status"]
            return {
                "status": status,
                "alreadyProcessed": True,
                "success": True,
                "transactionId": txns[0]["id"],
                "transactionIds": [t["id"] for t in txns],
            }

        demo = not is_paystack_configured() and str(txns[0].get("paystack_reference") or "").startswith("demo_")
        if demo:
            for txn in active:
                db.run("UPDATE transactions SET status = 'pending' WHERE id = ?", (txn["id"],))
                reserve_item(txn["item_id"])
                notify(txn["buyer_id"], "payment", "Payment Received",
                       f"Demo payment for \"{txn['item_title']}\" is held in escrow.")
            return {
                "status": "pending", "success": True, "demo": True,
                "transactionId": active[0]["id"], "transactionIds": [t["id"] for t in active],
            }

        try:
            verified = paystack.verify_transaction(reference)
        except PaystackError as err:
            raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
        status = verified.get("status")
        if status != "success":
            raise HTTPException(status_code=400, detail={"error": f"Payment not successful ({status})"})

        for txn in active:
            db.run("UPDATE transactions SET status = 'pending' WHERE id = ?", (txn["id"],))
            reserve_item(txn["item_id"])
            notify(txn["buyer_id"], "payment", "Payment Received",
                   f"Payment of {txn['amount']} {txn['currency']} for \"{txn['item_title']}\" is held in escrow.")

        auth = verified.get("authorization") or {}
        if auth.get("authorization_code") and auth.get("reusable"):
            save_authorization(user["id"], auth)

        return {
            "status": "pending", "success": True,
            "transactionId": active[0]["id"], "transactionIds": [t["id"] for t in active],
            "currency": active[0]["currency"],
            "amount": sum(t["amount"] for t in active),
        }
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})


@router.get("/bank-transfer/{reference}")
def get_bank_transfer(reference: str, user: dict = Depends(require_user)):
    txn = db.get(
        "SELECT * FROM transactions WHERE paystack_reference = ? AND method = 'bank_transfer' ORDER BY created_at LIMIT 1",
        (reference,),
    )
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Bank transfer not found"})
    if txn["buyer_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    return {
        "status": txn["status"],
        "paid": txn["status"] in ("pending", "completed"),
        "bankTransfer": public_bank_transfer(txn),
    }


# ---- Transaction lifecycle ------------------------------------------------------


def expire_awaiting_payment(txn):
    if not txn or txn["status"] != "awaiting_payment":
        return False
    restore_credit(txn["buyer_id"], txn.get("credit_cents") or 0)
    db.run("UPDATE transactions SET status = 'expired', completed_at = NULL WHERE id = ?", (txn["id"],))
    notify(txn["buyer_id"], "payment", "Payment Expired",
           f"Your pending payment for \"{txn['item_title']}\" expired and was cancelled. Any store credit used has been returned.")
    return True


def finalize_completed(txn):
    if not txn or txn["status"] == "completed":
        return False
    db.run("UPDATE transactions SET status = 'completed', completed_at = datetime('now') WHERE id = ?", (txn["id"],))
    db.run("UPDATE items SET status = 'sold' WHERE id = ?", (txn["item_id"],))

    amount_cents = round(convert(txn["amount"], txn.get("currency") or DEFAULT_CURRENCY, DEFAULT_CURRENCY) * 100)
    fee_cents = round(amount_cents * get_fee_rate_for_seller(txn["seller_id"]))
    net_cents = amount_cents - fee_cents
    db.run("UPDATE transactions SET fee_amount = ?, net_amount = ? WHERE id = ?", (fee_cents / 100, net_cents / 100, txn["id"]))

    get_wallet(txn["seller_id"])
    db.run(
        "UPDATE wallets SET available_cents = available_cents + ?, lifetime_cents = lifetime_cents + ?, updated_at = datetime('now') WHERE user_id = ?",
        (net_cents, net_cents, txn["seller_id"]),
    )

    if txn.get("promo_code"):
        consume_promo(txn["promo_code"])

    credit_first_purchase(txn["buyer_id"])

    notify(txn["buyer_id"], "payment", "Payment Released",
           f"Payment of {txn['amount']} {txn['currency']} for \"{txn['item_title']}\" has been released.")
    notify(txn["seller_id"], "sale", "Item Sold",
           f"\"{txn['item_title']}\" has been sold for {txn['amount']} {txn['currency']}!")

    try:
        buyer = db.get("SELECT email FROM users WHERE id = ?", (txn["buyer_id"],))
        seller = db.get("SELECT email FROM users WHERE id = ?", (txn["seller_id"],))
        if buyer and buyer.get("email"):
            send_notification_email(buyer["email"], "Your order is complete",
                                    f"Your payment of {txn['amount']} {txn['currency']} for \"{txn['item_title']}\" has been released to the seller. Thank you for shopping on TradeHub!")
        if seller and seller.get("email"):
            send_notification_email(seller["email"], "You made a sale!",
                                    f"Congratulations! \"{txn['item_title']}\" was sold for {txn['amount']} {txn['currency']}. The funds are now in your wallet.")
    except Exception:
        pass
    return True


def refund_txn(txn, opts=None):
    opts = opts or {}
    if not txn or txn["status"] == "refunded":
        return False

    credit_cents = txn.get("credit_cents") or 0
    was_completed = txn["status"] == "completed"

    if credit_cents > 0:
        restore_credit(txn["buyer_id"], credit_cents)
    elif txn["method"] in ("credit", "gift_card"):
        restore_credit(txn["buyer_id"], round(txn["amount"] * 100))

    if was_completed:
        w = db.get("SELECT * FROM wallets WHERE user_id = ?", (txn["seller_id"],))
        if w and (w["lifetime_cents"] > 0 or w["available_cents"] > 0):
            amount_cents = round(convert(txn["amount"], txn.get("currency") or DEFAULT_CURRENCY, "NGN") * 100)
            fee_cents = round(amount_cents * get_fee_rate_for_seller(txn["seller_id"]))
            net_cents = amount_cents - fee_cents
            available = max(0, w["available_cents"] - net_cents)
            lifetime = max(0, w["lifetime_cents"] - net_cents)
            db.run(
                "UPDATE wallets SET available_cents = ?, lifetime_cents = ?, updated_at = datetime('now') WHERE user_id = ?",
                (available, lifetime, txn["seller_id"]),
            )
        if txn.get("promo_code"):
            release_promo(txn["promo_code"])

    if not opts.get("skip_gateway") and txn.get("paystack_reference") \
            and not str(txn["paystack_reference"]).startswith("demo_") and is_paystack_configured():
        try:
            amount_minor = to_minor_units(max(0, round(txn["amount"] * 100) - credit_cents) / 100, txn.get("currency") or DEFAULT_CURRENCY)
            if amount_minor > 0:
                paystack.refund(transaction=txn["paystack_reference"], amount_minor=amount_minor, currency=txn.get("currency") or DEFAULT_CURRENCY)
        except Exception as err:
            logger.error("Paystack refund failed for %s: %s", txn["id"], err)

    db.run("UPDATE transactions SET status = 'refunded', completed_at = NULL WHERE id = ?", (txn["id"],))
    db.run("UPDATE items SET status = 'active' WHERE id = ?", (txn["item_id"],))
    return True


# ---- Transactions list / receipts -----------------------------------------------


@router.post("/confirm/{txn_id}")
def confirm_payment(txn_id: str, user: dict = Depends(require_user)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["buyer_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    if txn["status"] != "pending":
        raise HTTPException(status_code=400, detail={"error": "Payment is not in escrow"})
    finalize_completed(txn)
    return {"success": True}


@router.get("/transactions")
def list_transactions(user: dict = Depends(require_user), filter: str = "all"):
    flt = filter or "all"
    if flt == "received":
        query = "SELECT * FROM transactions WHERE seller_id = ?"
        params = (user["id"],)
    elif flt == "sent":
        query = "SELECT * FROM transactions WHERE buyer_id = ?"
        params = (user["id"],)
    else:
        query = "SELECT * FROM transactions WHERE (buyer_id = ? OR seller_id = ?)"
        params = (user["id"], user["id"])
    query += " ORDER BY created_at DESC"
    return {"transactions": db.all(query, params)}


@router.get("/transactions/{txn_id}")
def get_receipt(txn_id: str, user: dict = Depends(require_user)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["buyer_id"] != user["id"] and txn["seller_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    item = db.get("SELECT * FROM items WHERE id = ?", (txn["item_id"],)) or None
    buyer = db.get("SELECT id, name, email, avatar, rating, review_count FROM users WHERE id = ?", (txn["buyer_id"],)) or None
    seller = db.get("SELECT id, name, email, avatar, rating, review_count FROM users WHERE id = ?", (txn["seller_id"],)) or None
    return {"receipt": {**txn, "item": item, "buyer": buyer, "seller": seller}}


@router.post("/transactions/{txn_id}/confirm-receipt")
def confirm_receipt(txn_id: str, user: dict = Depends(require_user)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["buyer_id"] != user["id"]:
        raise HTTPException(status_code=403, detail={"error": "Only the buyer can confirm receipt"})
    if txn["status"] != "pending":
        raise HTTPException(status_code=400, detail={"error": "Payment is not in escrow"})
    finalize_completed(txn)
    return {"success": True}


@router.post("/refund/{txn_id}")
def refund_payment(txn_id: str, user: dict = Depends(require_user)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["seller_id"] != user["id"] and txn["buyer_id"] != user["id"] and not user.get("isAdmin"):
        raise HTTPException(status_code=403, detail={"error": "Not authorized"})
    try:
        refund_txn(txn)
    except PaystackError as err:
        raise HTTPException(status_code=err.status or 500, detail={"error": str(err)})
    notify(txn["buyer_id"], "system", "Payment Refunded", f"Payment for \"{txn['item_title']}\" has been refunded.")
    return {"success": True}


@router.post("/admin/fund-confirmed/{txn_id}")
def admin_fund_confirmed(txn_id: str, user: dict = Depends(require_admin)):
    txn = db.get("SELECT * FROM transactions WHERE id = ?", (txn_id,))
    if not txn:
        raise HTTPException(status_code=404, detail={"error": "Transaction not found"})
    if txn["status"] != "awaiting_payment":
        raise HTTPException(status_code=400, detail={"error": "Transaction is not awaiting payment"})
    db.run("UPDATE transactions SET status = 'pending' WHERE id = ?", (txn["id"],))
    reserve_item(txn["item_id"])
    notify(txn["buyer_id"], "payment", "Payment Received",
           f"We received your {txn['method']} payment for \"{txn['item_title']}\". It is now held in escrow.")
    return {"success": True}


# ---- Seller analytics ------------------------------------------------------------


@router.get("/analytics/seller")
def seller_analytics(user: dict = Depends(require_user)):
    uid = user["id"]
    per_item = db.all(
        """
        SELECT i.id, i.title, i.views, i.favorites, i.status, i.created_at,
          (SELECT url FROM item_images WHERE item_id = i.id ORDER BY sort_order LIMIT 1) AS image,
          COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS sold_count,
          COALESCE(SUM(CASE WHEN t.status = 'completed' THEN t.net_amount ELSE 0 END), 0) AS revenue,
          MAX(CASE WHEN t.status = 'completed' THEN t.completed_at END) AS last_sale
        FROM items i
        LEFT JOIN transactions t ON t.item_id = i.id AND t.seller_id = i.seller_id
        WHERE i.seller_id = ?
        GROUP BY i.id
        ORDER BY i.created_at DESC
        """,
        (uid,),
    )
    totals = db.get(
        """
        SELECT
          COALESCE(SUM(views), 0) AS views,
          COALESCE(SUM(favorites), 0) AS favorites,
          COUNT(*) AS listings,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active
        FROM items WHERE seller_id = ?
        """,
        (uid,),
    )
    sales = db.all(
        """
        SELECT t.*, u.name AS buyer_name FROM transactions t
        LEFT JOIN users u ON u.id = t.buyer_id
        WHERE t.seller_id = ? AND t.status = 'completed'
        ORDER BY t.completed_at DESC LIMIT 20
        """,
        (uid,),
    )
    revenue_totals = db.get(
        """
        SELECT
          COALESCE(SUM(CASE WHEN status = 'completed' THEN net_amount ELSE 0 END), 0) AS completed,
          COALESCE(SUM(CASE WHEN status IN ('pending','awaiting_payment') THEN net_amount ELSE 0 END), 0) AS pending,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) AS sold
        FROM transactions WHERE seller_id = ?
        """,
        (uid,),
    )
    return {
        "perItem": per_item,
        "totals": {
            "views": totals["views"] if totals else 0,
            "favorites": totals["favorites"] if totals else 0,
            "listings": totals["listings"] if totals else 0,
            "active": totals["active"] if totals else 0,
        },
        "revenue": {
            "completed": revenue_totals["completed"] if revenue_totals else 0,
            "pending": revenue_totals["pending"] if revenue_totals else 0,
            "sold": revenue_totals["sold"] if revenue_totals else 0,
        },
        "sales": sales,
    }


def _bank_transfer_expires():
    return config.PAYSTACK_BANK_TRANSFER_EXPIRES_AT or None


def _paystack_callback_url():
    return config.PAYSTACK_CALLBACK_URL or None