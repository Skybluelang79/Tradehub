import logging

from . import config

logger = logging.getLogger("tradehub")


def send_notification_email(email, subject, body):
    """Send a transactional notification email.

    The Python port intentionally degrades to a log when SMTP is not
    configured (matches the Node behaviour of silently skipping), so the
    lifecycle flows never depend on email delivery succeeding.
    """
    if not config.EMAIL_CONFIGURED:
        logger.info("Email not configured; skipped %r to %s", subject, email)
        return
    logger.warning(
        "send_notification_email requested for %s (%s) but STMP sending is not ported to Python yet",
        email,
        subject,
    )