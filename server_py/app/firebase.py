import json
import logging
import time

import httpx
import jwt

from . import config

logger = logging.getLogger("tradehub")

GOOGLE_CERTS_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

_certs = {"data": None, "expires": 0.0}


def _get_google_certs():
    now = time.time()
    if _certs["data"] and _certs["expires"] > now:
        return _certs["data"]
    try:
        r = httpx.get(GOOGLE_CERTS_URL, timeout=10.0)
        r.raise_for_status()
        _certs["data"] = r.json()
        _certs["expires"] = now + 3600
        return _certs["data"]
    except Exception as exc:
        logger.warning("Failed to fetch Google certs: %s", exc)
        return None


def verify_firebase_token(id_token):
    """Verify a Firebase ID token, mirroring firebase-admin verifyIdToken.

    Returns the decoded claims (including ``uid``) or None on any failure, so
    callers can treat an unconfigured / invalid token identically to Node.
    """
    project_id = config.FIREBASE_PROJECT_ID
    if not project_id:
        return None
    try:
        header = jwt.get_unverified_header(id_token)
        kid = header.get("kid")
        certs = _get_google_certs()
        if not certs or kid not in certs:
            return None
        claims = jwt.decode(
            id_token,
            certs[kid],
            algorithms=["RS256"],
            audience=project_id,
            issuer=f"https://securetoken.google.com/{project_id}",
        )
        claims["uid"] = claims.get("user_id") or claims.get("sub")
        return claims
    except Exception:
        return None


def _service_account():
    if config.FIREBASE_SERVICE_ACCOUNT:
        try:
            return json.loads(config.FIREBASE_SERVICE_ACCOUNT)
        except Exception:
            return None
    if (
        config.FIREBASE_PROJECT_ID
        and config.FIREBASE_CLIENT_EMAIL
        and config.FIREBASE_PRIVATE_KEY
    ):
        return {
            "project_id": config.FIREBASE_PROJECT_ID,
            "client_email": config.FIREBASE_CLIENT_EMAIL,
            "private_key": config.FIREBASE_PRIVATE_KEY.replace("\\n", "\n"),
        }
    return None


def _access_token(service_account):
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": service_account["client_email"],
            "scope": FCM_SCOPE,
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        service_account["private_key"],
        algorithm="RS256",
    )
    r = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        },
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def send_push_notification(tokens, notification):
    service_account = _service_account()
    if not service_account:
        return None

    try:
        access = _access_token(service_account)
    except Exception as exc:
        logger.error("FCM auth error: %s", exc)
        return None

    url = f"https://fcm.googleapis.com/v1/projects/{service_account['project_id']}/messages:send"
    headers = {"Authorization": f"Bearer {access}"}
    token_list = tokens if isinstance(tokens, list) else [tokens]

    if notification.get("image"):
        notif = {"title": notification.get("title"), "body": notification.get("body"), "image": notification["image"]}
    else:
        notif = {"title": notification.get("title"), "body": notification.get("body")}

    data = {k: str(v) for k, v in (notification.get("data") or {}).items()}

    success = 0
    failure = 0
    responses = []
    for token in token_list:
        message = {"message": {"token": token, "notification": notif, "data": data}}
        try:
            r = httpx.post(url, headers=headers, json=message, timeout=10.0)
            if r.status_code == 200:
                success += 1
                responses.append({"success": True, "messageId": r.json().get("name")})
            else:
                failure += 1
                responses.append({"success": False, "error": r.text})
        except Exception as exc:
            failure += 1
            responses.append({"success": False, "error": str(exc)})

    return {"successCount": success, "failureCount": failure, "responses": responses}
