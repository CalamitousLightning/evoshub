"""
Server-side Supabase access.

Two very different keys are used here on purpose:

- SUPABASE_ANON_KEY  -> only ever used to *verify* a visitor's JWT against
  Supabase's own Auth server (GoTrue). It cannot be used to bypass RLS.
- SUPABASE_SERVICE_ROLE_KEY -> bypasses Row Level Security entirely. It must
  NEVER be sent to the browser, logged, or embedded in any response. It is
  read once from the environment and used only for the two operations this
  module exposes.

Both come from environment variables (.env locally, host env vars in
production) — never hard-code them.
"""

import os
import httpx

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class VisitorTokenInvalid(Exception):
    """Raised when a caller's Supabase access token doesn't check out."""


async def verify_visitor_token(access_token: str) -> str:
    """
    Verifies a Supabase auth access token by asking Supabase's own Auth
    server whose token it is. Returns the verified user id (auth.uid()).

    We deliberately do NOT trust any user id the client sends in the request
    body — only the id Supabase's Auth server confirms for this token. This
    is what prevents one visitor from writing a row/message as another.
    """
    if not access_token:
        raise VisitorTokenInvalid("Missing access token.")

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_ANON_KEY not configured.")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {access_token}",
            },
        )

    if resp.status_code != 200:
        raise VisitorTokenInvalid("Could not verify visitor session.")

    user = resp.json()
    user_id = user.get("id")
    if not user_id:
        raise VisitorTokenInvalid("Verified session had no user id.")
    return user_id


async def insert_website_request(row: dict) -> dict:
    """
    Inserts a row into public.website_requests using the service_role key,
    which is required here because the visitor's own anon-key session is
    still subject to RLS (that's fine for chat, but this endpoint also does
    server-side validation/sanitization/rate-limiting the DB constraints
    alone don't cover, so the insert happens from the trusted backend).
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured.")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{SUPABASE_URL}/rest/v1/website_requests",
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=representation",
            },
            json=row,
        )

    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Supabase insert failed: {resp.status_code} {resp.text}")

    data = resp.json()
    return data[0] if isinstance(data, list) else data
