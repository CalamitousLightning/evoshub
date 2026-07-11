"""
EVOS Business Hub — Backend API
Powered by EVOXERA TECHNOLOGY

Run:  uvicorn main:app --reload
Docs: http://localhost:8000/docs  (disabled automatically when ENVIRONMENT=production)
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from routes import admin, contact, website_requests
from utils.rate_limit import limiter

_IS_PROD = os.getenv("ENVIRONMENT", "development").strip().lower() == "production"

app = FastAPI(
    title="EVOS Business Hub API",
    description="Backend API for evoshub.xyz — EVOXERA TECHNOLOGY",
    version="1.0.0",
    # In production, don't hand out a free map of every endpoint/schema to
    # anyone who requests it. Keep /docs available in dev for convenience.
    docs_url=None if _IS_PROD else "/docs",
    redoc_url=None if _IS_PROD else "/redoc",
    openapi_url=None if _IS_PROD else "/openapi.json",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_allowed_origins = [
    o.strip()
    for o in os.getenv("ALLOWED_ORIGINS", "https://evoshub.xyz,http://localhost:5173").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Authorization", "Content-Type"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Belt-and-suspenders headers for a JSON API. The frontend (Vercel) sets
    its own equivalent headers for the HTML it serves — these cover direct
    hits to the API domain itself (e.g. someone opening the API URL
    directly, or a misconfigured client rendering a response as HTML).
    """
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        if _IS_PROD:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)

app.include_router(admin.router, prefix="/api")
app.include_router(contact.router, prefix="/api")
app.include_router(website_requests.router, prefix="/api")


@app.get("/")
def root():
    return {
        "status": "ok",
        "platform": "EVOS Business Hub",
        "powered_by": "EVOXERA TECHNOLOGY",
        "docs": None if _IS_PROD else "/docs",
    }
