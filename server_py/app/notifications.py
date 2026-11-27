import json
import logging
import uuid

from . import db
from .firebase import send_push_notification

logger = logging.getLogger("tradehub")


def notify(user_id, ntype, title, body, data=None):
    values = (str(uuid.uuid4()), user_id, ntype, title, body)
    if data is not None:
        db.run(
            "INSERT INTO notifications (id, user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?, ?)",
            values + (data,),
        )
    else:
        db.run(
            "INSERT INTO notifications (id, user_id, type, title, body) VALUES (?, ?, ?, ?, ?)",
            values,
        )

    try:
        settings = db.get(
            "SELECT fcm_token, notifications FROM user_settings WHERE user_id = ?",
            (user_id,),
        )
        if not settings or settings["notifications"] == 0 or not settings["fcm_token"]:
            return

        payload = {}
        if isinstance(data, str):
            try:
                payload = json.loads(data)
            except Exception:
                payload = {}
        elif isinstance(data, dict):
            payload = data
        payload["type"] = ntype

        send_push_notification(
            settings["fcm_token"],
            {"title": title, "body": body, "data": payload},
        )
    except Exception as exc:
        logger.warning("Push notification skipped for %s: %s", user_id, exc)
