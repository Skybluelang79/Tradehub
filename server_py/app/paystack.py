import logging

import httpx

from . import config
from .currencies import is_valid_currency as _is_valid_currency
from .currencies import is_paystack_currency as _is_paystack_currency
from .currencies import PAYSTACK_CURRENCIES

logger = logging.getLogger("tradehub")

BASE_URL = "https://api.paystack.co"

PAYSTACK_CHANNELS = ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer", "eft"]

DEFAULT_CURRENCY = config.PAYSTACK_CURRENCY or "NGN"


def is_paystack_configured():
    return bool(config.PAYSTACK_SECRET_KEY)


def is_valid_currency(c):
    return _is_valid_currency(c)


def is_paystack_currency(c):
    return _is_paystack_currency(c)


def normalize_channels(channels):
    if not isinstance(channels, list):
        return None
    cleaned = []
    seen = set()
    for c in channels:
        key = str(c or "").lower().strip()
        if key in PAYSTACK_CHANNELS and key not in seen:
            seen.add(key)
            cleaned.append(key)
    return cleaned if cleaned else None


def to_minor_units(amount, currency=DEFAULT_CURRENCY):
    return round(float(amount) * 100)


def to_major_units(minor, currency=DEFAULT_CURRENCY):
    return round((minor or 0) / 100, 2)


class PaystackError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status or 502


_client = None


def _http():
    global _client
    if _client is None:
        _client = httpx.Client(timeout=20.0)
    return _client


class Paystack:
    def __init__(self):
        self.public_key = config.PAYSTACK_PUBLIC_KEY

    def request(self, method, path, body=None):
        if not is_paystack_configured():
            raise PaystackError("Paystack is not configured. Set PAYSTACK_SECRET_KEY.", 503)
        try:
            res = _http().request(
                method,
                f"{BASE_URL}{path}",
                json=body,
                headers={
                    "Authorization": f"Bearer {config.PAYSTACK_SECRET_KEY}",
                    "Content-Type": "application/json",
                },
            )
            data = res.json()
            if isinstance(data, dict) and data.get("status") is False:
                raise PaystackError(data.get("message") or "Paystack request failed", 400)
            return (data or {}).get("data")
        except PaystackError:
            raise
        except Exception as err:
            msg = getattr(err, "message", None) or str(err) or "Paystack request failed"
            logger.error("Paystack %s %s failed: %s", method, path, msg)
            status = getattr(err, "response", None)
            code = getattr(status, "status_code", None) if status is not None else None
            raise PaystackError(msg, code or 502)

    def initialize_transaction(
        self,
        amount_minor,
        currency=None,
        email=None,
        reference=None,
        metadata=None,
        channels=None,
        callback_url=None,
        plan_code=None,
    ):
        body = {
            "amount": amount_minor,
            "currency": str(currency or DEFAULT_CURRENCY).upper(),
            "email": email,
            "reference": reference,
            "metadata": metadata or {},
            "callback_url": callback_url or config.PAYSTACK_CALLBACK_URL or "",
        }
        normalized = normalize_channels(channels)
        if normalized:
            body["channels"] = normalized
        if plan_code:
            body["plan"] = plan_code
        return self.request("POST", "/transaction/initialize", body)

    def charge_bank_transfer(self, amount_minor, currency=None, email=None, reference=None, metadata=None, expires_at=None):
        return self.request("POST", "/charge", {
            "email": email,
            "amount": amount_minor,
            "currency": str(currency or DEFAULT_CURRENCY).upper(),
            "reference": reference,
            "metadata": metadata or {},
            "bank_transfer": {"account_expires_at": expires_at} if expires_at else {"account_expires_at": None},
        })

    def create_plan(self, name, amount_minor, interval="monthly", currency=None):
        return self.request("POST", "/plan", {
            "name": name,
            "amount": amount_minor,
            "interval": interval,
            "currency": str(currency or DEFAULT_CURRENCY).upper(),
        })

    def list_plans(self):
        return self.request("GET", "/plan")

    def create_subscription(self, customer, plan_code, authorization=None, start_date=None):
        body = {"customer": customer, "plan": plan_code}
        if authorization:
            body["authorization"] = authorization
        if start_date:
            body["start_date"] = start_date
        return self.request("POST", "/subscription", body)

    def disable_subscription(self, code, token):
        return self.request("POST", "/subscription/disable", {"code": code, "token": token})

    def enable_subscription(self, code, token):
        return self.request("POST", "/subscription/enable", {"code": code, "token": token})

    def verify_transaction(self, reference):
        return self.request("GET", f"/transaction/verify/{reference}")

    def charge_authorization(self, amount_minor, currency=None, email=None, authorization_code=None, reference=None, metadata=None):
        return self.request("POST", "/transaction/charge_authorization", {
            "amount": amount_minor,
            "currency": str(currency or DEFAULT_CURRENCY).upper(),
            "email": email,
            "authorization_code": authorization_code,
            "reference": reference,
            "metadata": metadata or {},
        })

    def refund_transaction(self, reference):
        return self.request("POST", "/refund", {"transaction": reference})

    def refund(self, reference, amount_minor=None, currency=None):
        body = {"transaction": reference, "currency": currency or DEFAULT_CURRENCY}
        if amount_minor is not None:
            body["amount"] = amount_minor
        return self.request("POST", "/refund", body)

    def get_or_create_customer(self, email, metadata=None):
        try:
            existing = self.request("GET", f"/customer/{email}")
            if existing:
                return existing
        except Exception:
            pass
        return self.request("POST", "/customer", {"email": email, "metadata": metadata or {}})

    def list_banks(self):
        return self.request("GET", "/bank?country=nigeria")

    def create_transfer_recipient(self, type_, name, account_number, bank_code, currency=None):
        return self.request("POST", "/transferrecipient", {
            "type": type_ or "nuban",
            "name": name,
            "account_number": str(account_number),
            "bank_code": str(bank_code),
            "currency": str(currency or DEFAULT_CURRENCY).upper(),
        })

    def initiate_transfer(self, amount_minor, recipient_code, reference, reason=None):
        return self.request("POST", "/transfer", {
            "source": "balance",
            "amount": amount_minor,
            "recipient": recipient_code,
            "reference": reference,
            "reason": reason or "TradeHub payout",
        })

    def balance(self):
        return self.request("GET", "/balance")


paystack = Paystack()


def verify_paystack_webhook(payload: bytes, signature: str):
    import hashlib
    import hmac

    secret = config.PAYSTACK_WEBHOOK_SECRET
    if not secret or not signature:
        return False
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha512).hexdigest()
    return hmac.compare_digest(digest, signature)