import logging
import re

import httpx

from . import config

logger = logging.getLogger("tradehub")

API_URL = "https://api.termii.com/v1/sms/send"


def is_sms_configured() -> bool:
    return bool(config.SMS_API_KEY)


def normalize_phone(input_value) -> str:
    raw = str(input_value or "").strip()
    if not raw:
        return ""
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return ""
    national = digits[1:] if len(digits) == 11 and digits.startswith("0") else digits
    if len(national) < 7 or len(national) > 15:
        return ""
    return national


def format_phone(digits) -> str:
    value = str(digits or "")
    if len(value) == 10:
        return f"{value[0:3]} {value[3:6]} {value[6:]}"
    return value


async def _post_sms(to: str, message: str):
    headers = {"api-key": config.SMS_API_KEY, "Content-Type": "application/json"}
    payload = {"to": to, "from": config.SMS_SENDER or "TradeHub", "message": message}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(API_URL, headers=headers, json=payload)
    try:
        data = resp.json()
    except Exception:
        data = {}
    if not resp.is_success or data.get("status") == "failed":
        raise Exception(data.get("message") or f"TermiiA responded with {resp.status_code}")
    return data


async def send_sms(to: str, message: str):
    if not is_sms_configured():
        if config.IS_PRODUCTION:
            raise Exception("SMS provider is not configured")
        logger.warning("SMS not sent (no SMS_API_KEY). Would message %s: %s", to, message)
        return {"delivered": False}
    try:
        data = await _post_sms(to, message)
        logger.info("SMS sent -> %s", to)
        result = {"delivered": True}
        if isinstance(data, dict):
            result.update(data)
        return result
    except Exception as err:
        logger.error("SMS failed to %s: %s", to, err)
        raise


async def send_otp_sms(to: str, code: str):
    return await send_sms(
        to,
        f"{code} is your TradeHub verification code. It expires in 10 minutes. Do not share it with anyone.",
    )


isSmsConfigured = is_sms_configured
normalizePhone = normalize_phone
formatPhone = format_phone
sendSms = send_sms
sendOtpSms = send_otp_sms
