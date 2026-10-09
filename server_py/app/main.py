from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .routers import auth, follows, health, items, offers, reviews, searches, verification

app = FastAPI(title="TradeHub API", version="py-0.1.0")


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
app.include_router(verification.router, prefix="/api/verification")