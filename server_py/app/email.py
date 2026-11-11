import html
import logging
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from . import config

logger = logging.getLogger("tradehub")


def _plain_text(markup):
    return re.sub(r"<[^>]+>", " ", markup)


def send_mail(to, subject, markup):
    """Send an HTML email, returning True on success.

    Delivery failures are logged instead of raised so callers (signup,
    password reset, escrow release) never fail because SMTP is down.
    """
    if not config.EMAIL_CONFIGURED:
        logger.info("Email not configured; skipped %r to %s", subject, to)
        return False

    message = EmailMessage()
    message["From"] = formataddr((config.EMAIL_FROM_NAME, config.EMAIL_FROM))
    message["To"] = to
    message["Subject"] = subject
    message.set_content(_plain_text(markup))
    message.add_alternative(markup, subtype="html")

    try:
        context = ssl.create_default_context()
        if config.SMTP_SECURE:
            with smtplib.SMTP_SSL(
                config.SMTP_HOST, config.SMTP_PORT, timeout=20, context=context
            ) as server:
                server.login(config.SMTP_USER, config.SMTP_PASS)
                server.send_message(message)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as server:
                server.ehlo()
                if server.has_extn("starttls"):
                    server.starttls(context=context)
                    server.ehlo()
                server.login(config.SMTP_USER, config.SMTP_PASS)
                server.send_message(message)
    except Exception as err:
        logger.error("Email failed to %s: %s", to, err)
        return False

    logger.info("Email sent to %s (%s)", to, subject)
    return True


def send_verification_email(email, token):
    url = f"{config.APP_URL}/verify-email?token={token}"
    return send_mail(
        email,
        "Verify your TradeHub email",
        "<h2>Welcome to TradeHub!</h2>"
        "<p>Click the link below to verify your email address:</p>"
        f'<a href="{url}">{url}</a>'
        "<p>This link expires in 24 hours.</p>",
    )


def send_password_reset_email(email, token):
    url = f"{config.APP_URL}/reset-password?token={token}"
    return send_mail(
        email,
        "Reset your TradeHub password",
        "<h2>Password Reset</h2>"
        "<p>Click the link below to reset your password:</p>"
        f'<a href="{url}">{url}</a>'
        "<p>This link expires in 1 hour.</p>"
        "<p>If you didn't request this, ignore this email.</p>",
    )


def send_notification_email(email, subject, body):
    safe_subject = html.escape(str(subject or ""))
    safe_body = html.escape(str(body or ""))
    return send_mail(
        email,
        str(subject or ""),
        f"<h2>{safe_subject}</h2><p>{safe_body}</p>",
    )
