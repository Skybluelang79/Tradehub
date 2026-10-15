import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config, scheduler
from .routers import (
    admin,
    ai,
    auth,
    auth_social,
    blocking,
    chat,
    disputes,
    fcm,
    firebase,
    follows,
    giftcards,
    health,
    items,
    notifications,
    offers,
    payouts,
    payments,
    phone_auth,
    promotions,
    referrals,
    reports,
    reviews,
    searches,
    settings,
    subscriptions,
    templates,
    upload,
    verification,
    vision,
    webauthn,
    webhooks,
)

logger = logging.getLogger("tradehub")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Seed the admin account before serving traffic. Routes guarded by
    # require_user (e.g. GET /api/disputes) return 401 "User not found" for a
    # valid admin token when the users row is missing, which signs the admin
    # out of the panel.
    try:
        admin.ensure_admin_row()
    except Exception:
        logger.exception("Failed to seed admin account")
    if not config.IS_PRODUCTION or config.RUN_SCHEDULER:
        scheduler.start_scheduler()
    yield


app = FastAPI(title="TradeHub API", version="py-0.1.0", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(status_code=exc.status_code, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    details = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", []) if p not in ("body", "query", "path", "header"))
        msg = err.get("msg", "Invalid value")
        details.append(f"{loc}: {msg}" if loc else msg)
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"error": "Validation failed", "details": details})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(items.router, prefix="/api/items")
app.include_router(reviews.router, prefix="/api/reviews")
app.include_router(offers.router, prefix="/api/offers")
app.include_router(searches.router, prefix="/api/searches")
app.include_router(follows.router, prefix="/api/follows")
app.include_router(payments.router, prefix="/api/payments")
app.include_router(verification.router, prefix="/api/verification")
app.include_router(chat.router, prefix="/api/chat")
app.include_router(notifications.router, prefix="/api/notifications")

app.include_router(auth_social.router, prefix="/api/auth")
app.include_router(upload.router, prefix="/api/upload")
app.include_router(templates.router, prefix="/api/templates")
app.include_router(settings.router, prefix="/api/settings")
app.include_router(fcm.router, prefix="/api/fcm")
app.include_router(firebase.router, prefix="/api/firebase")
app.include_router(subscriptions.router, prefix="/api/subscription")
app.include_router(webhooks.router, prefix="/api/webhooks")
app.include_router(payouts.router, prefix="/api/payouts")
app.include_router(giftcards.router, prefix="/api/payments/gift-cards")
app.include_router(referrals.router, prefix="/api/referrals")
app.include_router(promotions.router, prefix="/api/promotions")
app.include_router(disputes.router, prefix="/api/disputes")
app.include_router(reports.router, prefix="/api/reports")
app.include_router(blocking.router, prefix="/api/blocking")
app.include_router(phone_auth.router, prefix="/api/phone-auth")
app.include_router(webauthn.router, prefix="/api/webauthn")
app.include_router(admin.router, prefix="/api/admin")
app.include_router(ai.router, prefix="/api/ai")
app.include_router(vision.router, prefix="/api/vision")


from . import realtime as _realtime  # noqa: E402

app = _realtime.wrap(app)